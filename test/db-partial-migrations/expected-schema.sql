--
-- PostgreSQL database dump
--

-- Dumped from database version 14.10 (Debian 14.10-1.pgdg120+1)
-- Dumped by pg_dump version 16.8 (Ubuntu 16.8-1.pgdg24.04+1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: postgres
--

-- *not* creating schema, since initdb creates it


ALTER SCHEMA public OWNER TO postgres;

--
-- Name: citext; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS citext WITH SCHEMA public;


--
-- Name: EXTENSION citext; Type: COMMENT; Schema: -; Owner: 
--

COMMENT ON EXTENSION citext IS 'data type for case-insensitive character strings';


--
-- Name: pg_trgm; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;


--
-- Name: EXTENSION pg_trgm; Type: COMMENT; Schema: -; Owner: 
--

COMMENT ON EXTENSION pg_trgm IS 'text similarity measurement and index searching based on trigrams';


--
-- Name: pgrowlocks; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pgrowlocks WITH SCHEMA public;


--
-- Name: EXTENSION pgrowlocks; Type: COMMENT; Schema: -; Owner: 
--

COMMENT ON EXTENSION pgrowlocks IS 'show row-level locking information';


--
-- Name: conflictType; Type: TYPE; Schema: public; Owner: jubilant
--

CREATE TYPE public."conflictType" AS ENUM (
    'soft',
    'hard'
);


ALTER TYPE public."conflictType" OWNER TO jubilant;

--
-- Name: s3_upload_status; Type: TYPE; Schema: public; Owner: jubilant
--

CREATE TYPE public.s3_upload_status AS ENUM (
    'pending',
    'uploaded',
    'failed'
);


ALTER TYPE public.s3_upload_status OWNER TO jubilant;

--
-- Name: check_email(); Type: FUNCTION; Schema: public; Owner: jubilant
--

CREATE FUNCTION public.check_email() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
  declare extant int;
  begin
    select count(*) into extant from users inner join
      (select id from actors where "deletedAt" is null and id != NEW."actorId")
        as actors on actors.id=users."actorId"
      where email=NEW.email limit 1;
    if extant > 0 then
      raise exception 'ODK01:%', NEW.email;
    end if;
    return NEW;
  end;
$$;


ALTER FUNCTION public.check_email() OWNER TO jubilant;

--
-- Name: check_field_collisions(); Type: FUNCTION; Schema: public; Owner: jubilant
--

CREATE FUNCTION public.check_field_collisions() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
  declare extant int;
  declare extformid int;
  declare extpath text;
  declare exttype text;
  begin
    -- factoring the repeated joins here into a CTE explodes the cost by 10x

    select count(distinct type), form_fields."formId", form_fields.path into extant, extformid, extpath
      from form_fields

      -- finds canonical formDefIds (published, or active draft)
      left outer join (select id from form_defs where "publishedAt" is not null) as form_defs
        on form_defs.id = form_fields."formDefId"
      left outer join (select id, "draftDefId" from forms) as forms
        on forms."draftDefId" = form_fields."formDefId"

      -- weeds out paths whose latest def indicates they are a string. first figure
      -- out latest def, then knock out latest strings from conflict detection.
      inner join
        (select form_fields."formId", max("formDefId") as "latestDefId" from form_fields
          -- this is a repeat of the above canonical-def subquery
          left outer join (select id from form_defs where "publishedAt" is not null) as ifds
            on ifds.id = form_fields."formDefId"
          left outer join (select id, "draftDefId" from forms) as ifs
            on ifs."draftDefId" = form_fields."formDefId"
          where ifs.id is not null or ifds.id is not null
          group by form_fields."formId"
        ) as tail
        on tail."formId" = form_fields."formId"
      inner join
        (select "formDefId", path from form_fields where type != 'string') as nonstring
        on "latestDefId" = nonstring."formDefId" and form_fields.path = nonstring.path

      where forms.id is not null or form_defs.id is not null
      group by form_fields."formId", form_fields.path having count(distinct type) > 1;

    if extant > 0 then
      select type into exttype
        from form_fields
        where "formId" = extformid and path = extpath
        order by "formDefId" desc
        limit 1
        offset 1;

      raise exception using message = format('ODK05:%s:%s', extpath, exttype);
    end if;

    return NEW;
  end;
$$;


ALTER FUNCTION public.check_field_collisions() OWNER TO jubilant;

--
-- Name: check_form_state(); Type: FUNCTION; Schema: public; Owner: jubilant
--

CREATE FUNCTION public.check_form_state() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
  begin
    if NEW.state is null or NEW.state not in ('open', 'closing', 'closed') then
      raise exception 'ODK03:%', NEW.state;
    end if;
    return NEW;
  end;
$$;


ALTER FUNCTION public.check_form_state() OWNER TO jubilant;

--
-- Name: check_form_version(); Type: FUNCTION; Schema: public; Owner: jubilant
--

CREATE FUNCTION public.check_form_version() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
  declare extant int;
  declare pid int;
  declare xmlid text;
  declare vstr text;
  begin
    select count(*), "projectId", "xmlFormId", version into extant, pid, xmlid, vstr
      from form_defs
      inner join (select id, "xmlFormId", "projectId" from forms)
        as forms on forms.id = form_defs."formId"
      where "publishedAt" is not null
      group by "projectId", "xmlFormId", version
      having count(form_defs.id) > 1;

    if extant > 0 then
      raise exception using message = format('ODK02:%s:%L:%L', pid, xmlid, vstr);
    end if;

    return NEW;
  end;
$$;


ALTER FUNCTION public.check_form_version() OWNER TO jubilant;

--
-- Name: check_instanceid_unique(); Type: FUNCTION; Schema: public; Owner: jubilant
--

CREATE FUNCTION public.check_instanceid_unique() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
  declare fid int;
  declare drft boolean;
  declare found int;
  begin
    select "formId", draft into fid, drft from submissions where submissions.id=NEW."submissionId";
    select count(*) into found from submissions
      join submission_defs on submissions.id=submission_defs."submissionId"
      where "formId"=fid and submission_defs."instanceId"=NEW."instanceId" and draft=drft;

    if found > 1 then
      raise exception using message = format('ODK06:%s', NEW."instanceId");
    end if;

    return NEW;
  end;
$$;


ALTER FUNCTION public.check_instanceid_unique() OWNER TO jubilant;

--
-- Name: check_managed_key(); Type: FUNCTION; Schema: public; Owner: jubilant
--

CREATE FUNCTION public.check_managed_key() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
  declare "projectKeyId" int;
  begin
    select "keyId" into "projectKeyId" from forms
      inner join projects on projects.id = forms."projectId"
      where forms.id = NEW."formId";
    if "projectKeyId" is not null and NEW."keyId" is null then
      raise exception 'ODK04';
    end if;
    return NEW;
  end;
$$;


ALTER FUNCTION public.check_managed_key() OWNER TO jubilant;

--
-- Name: check_review_state(); Type: FUNCTION; Schema: public; Owner: jubilant
--

CREATE FUNCTION public.check_review_state() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
  begin
    if NEW."reviewState" is not null and NEW."reviewState" not in ('hasIssues', 'edited', 'approved', 'rejected') then
      raise exception 'ODK03:%', NEW."reviewState";
    end if;
    return NEW;
  end;
$$;


ALTER FUNCTION public.check_review_state() OWNER TO jubilant;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: actees; Type: TABLE; Schema: public; Owner: jubilant
--

CREATE TABLE public.actees (
    id character varying(36) NOT NULL,
    species character varying(36),
    parent character varying(36),
    "purgedAt" timestamp(3) with time zone,
    "purgedName" text,
    details jsonb
);


ALTER TABLE public.actees OWNER TO jubilant;

--
-- Name: actors; Type: TABLE; Schema: public; Owner: jubilant
--

CREATE TABLE public.actors (
    id integer NOT NULL,
    type character varying(15),
    "acteeId" character varying(36) NOT NULL,
    "displayName" character varying(64) NOT NULL,
    meta jsonb,
    "createdAt" timestamp(3) with time zone,
    "updatedAt" timestamp(3) with time zone,
    "deletedAt" timestamp(3) with time zone,
    "expiresAt" timestamp(3) with time zone
);


ALTER TABLE public.actors OWNER TO jubilant;

--
-- Name: actors_id_seq; Type: SEQUENCE; Schema: public; Owner: jubilant
--

CREATE SEQUENCE public.actors_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.actors_id_seq OWNER TO jubilant;

--
-- Name: actors_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: jubilant
--

ALTER SEQUENCE public.actors_id_seq OWNED BY public.actors.id;


--
-- Name: assignments; Type: TABLE; Schema: public; Owner: jubilant
--

CREATE TABLE public.assignments (
    "actorId" integer NOT NULL,
    "roleId" integer NOT NULL,
    "acteeId" character varying(36) NOT NULL
);


ALTER TABLE public.assignments OWNER TO jubilant;

--
-- Name: audits; Type: TABLE; Schema: public; Owner: jubilant
--

CREATE TABLE public.audits (
    "actorId" integer,
    action text NOT NULL,
    "acteeId" character varying(36),
    details jsonb,
    "loggedAt" timestamp(3) with time zone,
    claimed timestamp(3) with time zone,
    processed timestamp(3) with time zone,
    "lastFailure" timestamp(3) with time zone,
    failures integer DEFAULT 0,
    id integer NOT NULL,
    notes text
);


ALTER TABLE public.audits OWNER TO jubilant;

--
-- Name: audits_id_seq; Type: SEQUENCE; Schema: public; Owner: jubilant
--

CREATE SEQUENCE public.audits_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.audits_id_seq OWNER TO jubilant;

--
-- Name: audits_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: jubilant
--

ALTER SEQUENCE public.audits_id_seq OWNED BY public.audits.id;


--
-- Name: blobs; Type: TABLE; Schema: public; Owner: jubilant
--

CREATE TABLE public.blobs (
    id integer NOT NULL,
    sha character varying(40) NOT NULL,
    content bytea,
    "contentType" text DEFAULT 'application/octet-stream'::text NOT NULL,
    md5 character varying(32) NOT NULL,
    s3_status public.s3_upload_status DEFAULT 'pending'::public.s3_upload_status NOT NULL
);


ALTER TABLE public.blobs OWNER TO jubilant;

--
-- Name: blobs_id_seq; Type: SEQUENCE; Schema: public; Owner: jubilant
--

CREATE SEQUENCE public.blobs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.blobs_id_seq OWNER TO jubilant;

--
-- Name: blobs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: jubilant
--

ALTER SEQUENCE public.blobs_id_seq OWNED BY public.blobs.id;


--
-- Name: client_audits; Type: TABLE; Schema: public; Owner: jubilant
--

CREATE TABLE public.client_audits (
    "blobId" integer NOT NULL,
    event text,
    node text,
    start text,
    "end" text,
    latitude text,
    longitude text,
    accuracy text,
    "old-value" text,
    "new-value" text,
    remainder jsonb,
    "user" text,
    "change-reason" text
);


ALTER TABLE public.client_audits OWNER TO jubilant;

--
-- Name: comments; Type: TABLE; Schema: public; Owner: jubilant
--

CREATE TABLE public.comments (
    id integer NOT NULL,
    "submissionId" integer NOT NULL,
    "actorId" integer NOT NULL,
    body text NOT NULL,
    "createdAt" timestamp(3) with time zone
);


ALTER TABLE public.comments OWNER TO jubilant;

--
-- Name: comments_id_seq; Type: SEQUENCE; Schema: public; Owner: jubilant
--

CREATE SEQUENCE public.comments_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.comments_id_seq OWNER TO jubilant;

--
-- Name: comments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: jubilant
--

ALTER SEQUENCE public.comments_id_seq OWNED BY public.comments.id;


--
-- Name: config; Type: TABLE; Schema: public; Owner: jubilant
--

CREATE TABLE public.config (
    key character varying(40) NOT NULL,
    value jsonb,
    "setAt" timestamp(3) with time zone
);


ALTER TABLE public.config OWNER TO jubilant;

--
-- Name: dataset_form_defs; Type: TABLE; Schema: public; Owner: jubilant
--

CREATE TABLE public.dataset_form_defs (
    "datasetId" integer NOT NULL,
    "formDefId" integer NOT NULL,
    actions jsonb NOT NULL
);


ALTER TABLE public.dataset_form_defs OWNER TO jubilant;

--
-- Name: datasets; Type: TABLE; Schema: public; Owner: jubilant
--

CREATE TABLE public.datasets (
    id integer NOT NULL,
    name text NOT NULL,
    "acteeId" character varying(36) NOT NULL,
    "createdAt" timestamp(3) with time zone NOT NULL,
    "projectId" integer NOT NULL,
    "publishedAt" timestamp(3) with time zone,
    "approvalRequired" boolean DEFAULT false NOT NULL
);


ALTER TABLE public.datasets OWNER TO jubilant;

--
-- Name: datasets_id_seq; Type: SEQUENCE; Schema: public; Owner: jubilant
--

CREATE SEQUENCE public.datasets_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.datasets_id_seq OWNER TO jubilant;

--
-- Name: datasets_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: jubilant
--

ALTER SEQUENCE public.datasets_id_seq OWNED BY public.datasets.id;


--
-- Name: ds_properties; Type: TABLE; Schema: public; Owner: jubilant
--

CREATE TABLE public.ds_properties (
    id integer NOT NULL,
    name text NOT NULL,
    "datasetId" integer NOT NULL,
    "publishedAt" timestamp(3) with time zone
);


ALTER TABLE public.ds_properties OWNER TO jubilant;

--
-- Name: ds_properties_id_seq; Type: SEQUENCE; Schema: public; Owner: jubilant
--

CREATE SEQUENCE public.ds_properties_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.ds_properties_id_seq OWNER TO jubilant;

--
-- Name: ds_properties_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: jubilant
--

ALTER SEQUENCE public.ds_properties_id_seq OWNED BY public.ds_properties.id;


--
-- Name: ds_property_fields; Type: TABLE; Schema: public; Owner: jubilant
--

CREATE TABLE public.ds_property_fields (
    "dsPropertyId" integer,
    "formDefId" integer,
    path text
);


ALTER TABLE public.ds_property_fields OWNER TO jubilant;

--
-- Name: entities; Type: TABLE; Schema: public; Owner: jubilant
--

CREATE TABLE public.entities (
    id integer NOT NULL,
    uuid character varying(255) NOT NULL,
    "datasetId" integer,
    "createdAt" timestamp(3) with time zone NOT NULL,
    "creatorId" integer NOT NULL,
    "updatedAt" timestamp(3) with time zone,
    "deletedAt" timestamp(3) with time zone,
    conflict public."conflictType"
);


ALTER TABLE public.entities OWNER TO jubilant;

--
-- Name: entities_id_seq; Type: SEQUENCE; Schema: public; Owner: jubilant
--

CREATE SEQUENCE public.entities_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.entities_id_seq OWNER TO jubilant;

--
-- Name: entities_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: jubilant
--

ALTER SEQUENCE public.entities_id_seq OWNED BY public.entities.id;


--
-- Name: entity_def_sources; Type: TABLE; Schema: public; Owner: jubilant
--

CREATE TABLE public.entity_def_sources (
    id integer NOT NULL,
    type character varying(36) NOT NULL,
    "auditId" integer,
    "submissionDefId" integer,
    details jsonb,
    "forceProcessed" boolean
);


ALTER TABLE public.entity_def_sources OWNER TO jubilant;

--
-- Name: entity_def_sources_id_seq; Type: SEQUENCE; Schema: public; Owner: jubilant
--

CREATE SEQUENCE public.entity_def_sources_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.entity_def_sources_id_seq OWNER TO jubilant;

--
-- Name: entity_def_sources_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: jubilant
--

ALTER SEQUENCE public.entity_def_sources_id_seq OWNED BY public.entity_def_sources.id;


--
-- Name: entity_defs; Type: TABLE; Schema: public; Owner: jubilant
--

CREATE TABLE public.entity_defs (
    id integer NOT NULL,
    "entityId" integer NOT NULL,
    "createdAt" timestamp(3) with time zone NOT NULL,
    current boolean,
    data jsonb NOT NULL,
    "creatorId" integer NOT NULL,
    "userAgent" character varying(255),
    label text NOT NULL,
    root boolean DEFAULT false NOT NULL,
    "sourceId" integer,
    version integer DEFAULT 1 NOT NULL,
    "dataReceived" jsonb DEFAULT '{}'::jsonb NOT NULL,
    "baseVersion" integer,
    "conflictingProperties" jsonb,
    "branchId" uuid,
    "trunkVersion" integer,
    "branchBaseVersion" integer
);


ALTER TABLE public.entity_defs OWNER TO jubilant;

--
-- Name: entity_defs_id_seq; Type: SEQUENCE; Schema: public; Owner: jubilant
--

CREATE SEQUENCE public.entity_defs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.entity_defs_id_seq OWNER TO jubilant;

--
-- Name: entity_defs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: jubilant
--

ALTER SEQUENCE public.entity_defs_id_seq OWNED BY public.entity_defs.id;


--
-- Name: entity_submission_backlog; Type: TABLE; Schema: public; Owner: jubilant
--

CREATE TABLE public.entity_submission_backlog (
    "submissionId" integer NOT NULL,
    "submissionDefId" integer NOT NULL,
    "branchId" uuid NOT NULL,
    "branchBaseVersion" integer NOT NULL,
    "loggedAt" timestamp(3) with time zone NOT NULL,
    "auditId" integer NOT NULL,
    "entityUuid" uuid NOT NULL
);


ALTER TABLE public.entity_submission_backlog OWNER TO jubilant;

--
-- Name: field_keys; Type: TABLE; Schema: public; Owner: jubilant
--

CREATE TABLE public.field_keys (
    "actorId" integer NOT NULL,
    "createdBy" integer NOT NULL,
    "projectId" integer
);


ALTER TABLE public.field_keys OWNER TO jubilant;

--
-- Name: form_attachments; Type: TABLE; Schema: public; Owner: jubilant
--

CREATE TABLE public.form_attachments (
    "formId" integer NOT NULL,
    "blobId" integer,
    name text NOT NULL,
    type text,
    "formDefId" integer NOT NULL,
    "updatedAt" timestamp(3) with time zone,
    "datasetId" integer,
    CONSTRAINT "check_blobId_or_datasetId_is_null" CHECK ((("blobId" IS NULL) OR ("datasetId" IS NULL))),
    CONSTRAINT "check_datasetId_is_null_for_non_file" CHECK (((type = 'file'::text) OR ("datasetId" IS NULL)))
);


ALTER TABLE public.form_attachments OWNER TO jubilant;

--
-- Name: form_defs; Type: TABLE; Schema: public; Owner: jubilant
--

CREATE TABLE public.form_defs (
    id integer NOT NULL,
    "formId" integer,
    xml text NOT NULL,
    hash character varying(32) NOT NULL,
    sha character varying(40) NOT NULL,
    sha256 character varying(64) NOT NULL,
    version text NOT NULL,
    "createdAt" timestamp(3) with time zone,
    "keyId" integer,
    "xlsBlobId" integer,
    "publishedAt" timestamp(3) with time zone,
    "draftToken" character varying(64),
    "enketoId" character varying(255),
    name text,
    "schemaId" integer
);


ALTER TABLE public.form_defs OWNER TO jubilant;

--
-- Name: form_defs_id_seq; Type: SEQUENCE; Schema: public; Owner: jubilant
--

CREATE SEQUENCE public.form_defs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.form_defs_id_seq OWNER TO jubilant;

--
-- Name: form_defs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: jubilant
--

ALTER SEQUENCE public.form_defs_id_seq OWNED BY public.form_defs.id;


--
-- Name: form_field_values; Type: TABLE; Schema: public; Owner: jubilant
--

CREATE TABLE public.form_field_values (
    "formId" integer NOT NULL,
    "submissionDefId" integer NOT NULL,
    path text NOT NULL,
    value text
);


ALTER TABLE public.form_field_values OWNER TO jubilant;

--
-- Name: form_fields; Type: TABLE; Schema: public; Owner: jubilant
--

CREATE TABLE public.form_fields (
    "formId" integer NOT NULL,
    path text NOT NULL,
    name text NOT NULL,
    type character varying(32) NOT NULL,
    "binary" boolean,
    "order" integer NOT NULL,
    "selectMultiple" boolean,
    "schemaId" integer NOT NULL
);


ALTER TABLE public.form_fields OWNER TO jubilant;

--
-- Name: form_schemas; Type: TABLE; Schema: public; Owner: jubilant
--

CREATE TABLE public.form_schemas (
    id integer NOT NULL
);


ALTER TABLE public.form_schemas OWNER TO jubilant;

--
-- Name: form_schemas_id_seq; Type: SEQUENCE; Schema: public; Owner: jubilant
--

CREATE SEQUENCE public.form_schemas_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.form_schemas_id_seq OWNER TO jubilant;

--
-- Name: form_schemas_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: jubilant
--

ALTER SEQUENCE public.form_schemas_id_seq OWNED BY public.form_schemas.id;


--
-- Name: forms; Type: TABLE; Schema: public; Owner: jubilant
--

CREATE TABLE public.forms (
    id integer NOT NULL,
    "xmlFormId" character varying(64) NOT NULL,
    "createdAt" timestamp(3) with time zone,
    "updatedAt" timestamp(3) with time zone,
    "deletedAt" timestamp(3) with time zone,
    "acteeId" character varying(36) NOT NULL,
    state text DEFAULT 'open'::text,
    "projectId" integer NOT NULL,
    "currentDefId" integer,
    "draftDefId" integer,
    "enketoId" character varying(255),
    "enketoOnceId" text,
    "webformsEnabled" boolean DEFAULT false NOT NULL
);


ALTER TABLE public.forms OWNER TO jubilant;

--
-- Name: forms_id_seq; Type: SEQUENCE; Schema: public; Owner: jubilant
--

CREATE SEQUENCE public.forms_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.forms_id_seq OWNER TO jubilant;

--
-- Name: forms_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: jubilant
--

ALTER SEQUENCE public.forms_id_seq OWNED BY public.forms.id;


--
-- Name: keys; Type: TABLE; Schema: public; Owner: jubilant
--

CREATE TABLE public.keys (
    id integer NOT NULL,
    public text NOT NULL,
    private jsonb,
    managed boolean,
    hint text,
    "createdAt" timestamp(3) with time zone
);


ALTER TABLE public.keys OWNER TO jubilant;

--
-- Name: keys_id_seq; Type: SEQUENCE; Schema: public; Owner: jubilant
--

CREATE SEQUENCE public.keys_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.keys_id_seq OWNER TO jubilant;

--
-- Name: keys_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: jubilant
--

ALTER SEQUENCE public.keys_id_seq OWNED BY public.keys.id;


--
-- Name: knex_migrations; Type: TABLE; Schema: public; Owner: jubilant
--

CREATE TABLE public.knex_migrations (
    id integer NOT NULL,
    name character varying(255),
    batch integer,
    migration_time timestamp(3) with time zone
);


ALTER TABLE public.knex_migrations OWNER TO jubilant;

--
-- Name: knex_migrations_id_seq; Type: SEQUENCE; Schema: public; Owner: jubilant
--

CREATE SEQUENCE public.knex_migrations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.knex_migrations_id_seq OWNER TO jubilant;

--
-- Name: knex_migrations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: jubilant
--

ALTER SEQUENCE public.knex_migrations_id_seq OWNED BY public.knex_migrations.id;


--
-- Name: knex_migrations_lock; Type: TABLE; Schema: public; Owner: jubilant
--

CREATE TABLE public.knex_migrations_lock (
    index integer NOT NULL,
    is_locked integer
);


ALTER TABLE public.knex_migrations_lock OWNER TO jubilant;

--
-- Name: knex_migrations_lock_index_seq; Type: SEQUENCE; Schema: public; Owner: jubilant
--

CREATE SEQUENCE public.knex_migrations_lock_index_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.knex_migrations_lock_index_seq OWNER TO jubilant;

--
-- Name: knex_migrations_lock_index_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: jubilant
--

ALTER SEQUENCE public.knex_migrations_lock_index_seq OWNED BY public.knex_migrations_lock.index;


--
-- Name: projects; Type: TABLE; Schema: public; Owner: jubilant
--

CREATE TABLE public.projects (
    id integer NOT NULL,
    name text NOT NULL,
    "acteeId" character varying(36) NOT NULL,
    "createdAt" timestamp(3) with time zone,
    "updatedAt" timestamp(3) with time zone,
    "deletedAt" timestamp(3) with time zone,
    archived boolean,
    "keyId" integer,
    description text
);


ALTER TABLE public.projects OWNER TO jubilant;

--
-- Name: projects_id_seq; Type: SEQUENCE; Schema: public; Owner: jubilant
--

CREATE SEQUENCE public.projects_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.projects_id_seq OWNER TO jubilant;

--
-- Name: projects_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: jubilant
--

ALTER SEQUENCE public.projects_id_seq OWNED BY public.projects.id;


--
-- Name: public_links; Type: TABLE; Schema: public; Owner: jubilant
--

CREATE TABLE public.public_links (
    "actorId" integer NOT NULL,
    "createdBy" integer NOT NULL,
    "formId" integer NOT NULL,
    once boolean
);


ALTER TABLE public.public_links OWNER TO jubilant;

--
-- Name: purged_entities; Type: TABLE; Schema: public; Owner: jubilant
--

CREATE TABLE public.purged_entities (
    "entityUuid" character varying NOT NULL,
    "acteeId" character varying NOT NULL,
    "auditId" integer NOT NULL
);


ALTER TABLE public.purged_entities OWNER TO jubilant;

--
-- Name: purged_entities_auditId_seq; Type: SEQUENCE; Schema: public; Owner: jubilant
--

CREATE SEQUENCE public."purged_entities_auditId_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public."purged_entities_auditId_seq" OWNER TO jubilant;

--
-- Name: purged_entities_auditId_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: jubilant
--

ALTER SEQUENCE public."purged_entities_auditId_seq" OWNED BY public.purged_entities."auditId";


--
-- Name: roles; Type: TABLE; Schema: public; Owner: jubilant
--

CREATE TABLE public.roles (
    id integer NOT NULL,
    name text NOT NULL,
    system character varying(8),
    "createdAt" timestamp(3) with time zone,
    "updatedAt" timestamp(3) with time zone,
    verbs jsonb
);


ALTER TABLE public.roles OWNER TO jubilant;

--
-- Name: roles_id_seq; Type: SEQUENCE; Schema: public; Owner: jubilant
--

CREATE SEQUENCE public.roles_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.roles_id_seq OWNER TO jubilant;

--
-- Name: roles_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: jubilant
--

ALTER SEQUENCE public.roles_id_seq OWNED BY public.roles.id;


--
-- Name: sessions; Type: TABLE; Schema: public; Owner: jubilant
--

CREATE TABLE public.sessions (
    "actorId" integer NOT NULL,
    token character varying(64) NOT NULL,
    "expiresAt" timestamp(3) with time zone NOT NULL,
    "createdAt" timestamp(3) with time zone,
    csrf character varying(64)
);


ALTER TABLE public.sessions OWNER TO jubilant;

--
-- Name: submission_attachments; Type: TABLE; Schema: public; Owner: jubilant
--

CREATE TABLE public.submission_attachments (
    "blobId" integer,
    name text NOT NULL,
    "submissionDefId" integer NOT NULL,
    index integer,
    "isClientAudit" boolean
);


ALTER TABLE public.submission_attachments OWNER TO jubilant;

--
-- Name: submission_defs; Type: TABLE; Schema: public; Owner: jubilant
--

CREATE TABLE public.submission_defs (
    id integer NOT NULL,
    "submissionId" integer NOT NULL,
    xml text NOT NULL,
    "formDefId" integer NOT NULL,
    "submitterId" integer,
    "createdAt" timestamp(3) with time zone,
    "encDataAttachmentName" character varying(255),
    "localKey" text,
    signature text,
    current boolean,
    "instanceName" text,
    "instanceId" character varying(64) NOT NULL,
    "userAgent" character varying(255),
    "deviceId" character varying(255),
    root boolean
);


ALTER TABLE public.submission_defs OWNER TO jubilant;

--
-- Name: submission_defs_id_seq; Type: SEQUENCE; Schema: public; Owner: jubilant
--

CREATE SEQUENCE public.submission_defs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.submission_defs_id_seq OWNER TO jubilant;

--
-- Name: submission_defs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: jubilant
--

ALTER SEQUENCE public.submission_defs_id_seq OWNED BY public.submission_defs.id;


--
-- Name: submissions; Type: TABLE; Schema: public; Owner: jubilant
--

CREATE TABLE public.submissions (
    id integer NOT NULL,
    "formId" integer NOT NULL,
    "instanceId" character varying(64) NOT NULL,
    "createdAt" timestamp(3) with time zone,
    "updatedAt" timestamp(3) with time zone,
    "deletedAt" timestamp(3) with time zone,
    "submitterId" integer,
    "deviceId" character varying(255),
    draft boolean NOT NULL,
    "reviewState" text
);


ALTER TABLE public.submissions OWNER TO jubilant;

--
-- Name: submissions_id_seq; Type: SEQUENCE; Schema: public; Owner: jubilant
--

CREATE SEQUENCE public.submissions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.submissions_id_seq OWNER TO jubilant;

--
-- Name: submissions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: jubilant
--

ALTER SEQUENCE public.submissions_id_seq OWNED BY public.submissions.id;


--
-- Name: user_project_preferences; Type: TABLE; Schema: public; Owner: jubilant
--

CREATE TABLE public.user_project_preferences (
    "userId" integer NOT NULL,
    "projectId" integer NOT NULL,
    "propertyName" text NOT NULL,
    "propertyValue" jsonb NOT NULL,
    CONSTRAINT "user_project_preferences_propertyName_check" CHECK ((length("propertyName") > 0))
);


ALTER TABLE public.user_project_preferences OWNER TO jubilant;

--
-- Name: user_site_preferences; Type: TABLE; Schema: public; Owner: jubilant
--

CREATE TABLE public.user_site_preferences (
    "userId" integer NOT NULL,
    "propertyName" text NOT NULL,
    "propertyValue" jsonb NOT NULL,
    CONSTRAINT "user_site_preferences_propertyName_check" CHECK ((length("propertyName") > 0))
);


ALTER TABLE public.user_site_preferences OWNER TO jubilant;

--
-- Name: users; Type: TABLE; Schema: public; Owner: jubilant
--

CREATE TABLE public.users (
    "actorId" integer NOT NULL,
    password character varying(64),
    email public.citext NOT NULL
);


ALTER TABLE public.users OWNER TO jubilant;

--
-- Name: actors id; Type: DEFAULT; Schema: public; Owner: jubilant
--

ALTER TABLE ONLY public.actors ALTER COLUMN id SET DEFAULT nextval('public.actors_id_seq'::regclass);


--
-- Name: audits id; Type: DEFAULT; Schema: public; Owner: jubilant
--

ALTER TABLE ONLY public.audits ALTER COLUMN id SET DEFAULT nextval('public.audits_id_seq'::regclass);


--
-- Name: blobs id; Type: DEFAULT; Schema: public; Owner: jubilant
--

ALTER TABLE ONLY public.blobs ALTER COLUMN id SET DEFAULT nextval('public.blobs_id_seq'::regclass);


--
-- Name: comments id; Type: DEFAULT; Schema: public; Owner: jubilant
--

ALTER TABLE ONLY public.comments ALTER COLUMN id SET DEFAULT nextval('public.comments_id_seq'::regclass);


--
-- Name: datasets id; Type: DEFAULT; Schema: public; Owner: jubilant
--

ALTER TABLE ONLY public.datasets ALTER COLUMN id SET DEFAULT nextval('public.datasets_id_seq'::regclass);


--
-- Name: ds_properties id; Type: DEFAULT; Schema: public; Owner: jubilant
--

ALTER TABLE ONLY public.ds_properties ALTER COLUMN id SET DEFAULT nextval('public.ds_properties_id_seq'::regclass);


--
-- Name: entities id; Type: DEFAULT; Schema: public; Owner: jubilant
--

ALTER TABLE ONLY public.entities ALTER COLUMN id SET DEFAULT nextval('public.entities_id_seq'::regclass);


--
-- Name: entity_def_sources id; Type: DEFAULT; Schema: public; Owner: jubilant
--

ALTER TABLE ONLY public.entity_def_sources ALTER COLUMN id SET DEFAULT nextval('public.entity_def_sources_id_seq'::regclass);


--
-- Name: entity_defs id; Type: DEFAULT; Schema: public; Owner: jubilant
--

ALTER TABLE ONLY public.entity_defs ALTER COLUMN id SET DEFAULT nextval('public.entity_defs_id_seq'::regclass);


--
-- Name: form_defs id; Type: DEFAULT; Schema: public; Owner: jubilant
--

ALTER TABLE ONLY public.form_defs ALTER COLUMN id SET DEFAULT nextval('public.form_defs_id_seq'::regclass);


--
-- Name: form_schemas id; Type: DEFAULT; Schema: public; Owner: jubilant
--

ALTER TABLE ONLY public.form_schemas ALTER COLUMN id SET DEFAULT nextval('public.form_schemas_id_seq'::regclass);


--
-- Name: forms id; Type: DEFAULT; Schema: public; Owner: jubilant
--

ALTER TABLE ONLY public.forms ALTER COLUMN id SET DEFAULT nextval('public.forms_id_seq'::regclass);


--
-- Name: keys id; Type: DEFAULT; Schema: public; Owner: jubilant
--

ALTER TABLE ONLY public.keys ALTER COLUMN id SET DEFAULT nextval('public.keys_id_seq'::regclass);


--
-- Name: knex_migrations id; Type: DEFAULT; Schema: public; Owner: jubilant
--

ALTER TABLE ONLY public.knex_migrations ALTER COLUMN id SET DEFAULT nextval('public.knex_migrations_id_seq'::regclass);


--
-- Name: knex_migrations_lock index; Type: DEFAULT; Schema: public; Owner: jubilant
--

ALTER TABLE ONLY public.knex_migrations_lock ALTER COLUMN index SET DEFAULT nextval('public.knex_migrations_lock_index_seq'::regclass);


--
-- Name: projects id; Type: DEFAULT; Schema: public; Owner: jubilant
--

ALTER TABLE ONLY public.projects ALTER COLUMN id SET DEFAULT nextval('public.projects_id_seq'::regclass);


--
-- Name: purged_entities auditId; Type: DEFAULT; Schema: public; Owner: jubilant
--

ALTER TABLE ONLY public.purged_entities ALTER COLUMN "auditId" SET DEFAULT nextval('public."purged_entities_auditId_seq"'::regclass);


--
-- Name: roles id; Type: DEFAULT; Schema: public; Owner: jubilant
--

ALTER TABLE ONLY public.roles ALTER COLUMN id SET DEFAULT nextval('public.roles_id_seq'::regclass);


--
-- Name: submission_defs id; Type: DEFAULT; Schema: public; Owner: jubilant
--

ALTER TABLE ONLY public.submission_defs ALTER COLUMN id SET DEFAULT nextval('public.submission_defs_id_seq'::regclass);


--
-- Name: submissions id; Type: DEFAULT; Schema: public; Owner: jubilant
--

ALTER TABLE ONLY public.submissions ALTER COLUMN id SET DEFAULT nextval('public.submissions_id_seq'::regclass);


--
-- Name: actees actees_pkey; Type: CONSTRAINT; Schema: public; Owner: jubilant
--

ALTER TABLE ONLY public.actees
    ADD CONSTRAINT actees_pkey PRIMARY KEY (id);


--
-- Name: actors actors_pkey; Type: CONSTRAINT; Schema: public; Owner: jubilant
--

ALTER TABLE ONLY public.actors
    ADD CONSTRAINT actors_pkey PRIMARY KEY (id);


--
-- Name: assignments assignments_pkey; Type: CONSTRAINT; Schema: public; Owner: jubilant
--

ALTER TABLE ONLY public.assignments
    ADD CONSTRAINT assignments_pkey PRIMARY KEY ("actorId", "roleId", "acteeId");


--
-- Name: audits audits_pkey; Type: CONSTRAINT; Schema: public; Owner: jubilant
--

ALTER TABLE ONLY public.audits
    ADD CONSTRAINT audits_pkey PRIMARY KEY (id);


--
-- Name: blobs blobs_pkey; Type: CONSTRAINT; Schema: public; Owner: jubilant
--

ALTER TABLE ONLY public.blobs
    ADD CONSTRAINT blobs_pkey PRIMARY KEY (id);


--
-- Name: blobs blobs_sha_unique; Type: CONSTRAINT; Schema: public; Owner: jubilant
--

ALTER TABLE ONLY public.blobs
    ADD CONSTRAINT blobs_sha_unique UNIQUE (sha);


--
-- Name: comments comments_pkey; Type: CONSTRAINT; Schema: public; Owner: jubilant
--

ALTER TABLE ONLY public.comments
    ADD CONSTRAINT comments_pkey PRIMARY KEY (id);


--
-- Name: config config_pkey; Type: CONSTRAINT; Schema: public; Owner: jubilant
--

ALTER TABLE ONLY public.config
    ADD CONSTRAINT config_pkey PRIMARY KEY (key);


--
-- Name: dataset_form_defs dataset_form_defs_datasetid_formdefid_unique; Type: CONSTRAINT; Schema: public; Owner: jubilant
--

ALTER TABLE ONLY public.dataset_form_defs
    ADD CONSTRAINT dataset_form_defs_datasetid_formdefid_unique UNIQUE ("datasetId", "formDefId");


--
-- Name: datasets datasets_name_projectid_unique; Type: CONSTRAINT; Schema: public; Owner: jubilant
--

ALTER TABLE ONLY public.datasets
    ADD CONSTRAINT datasets_name_projectid_unique UNIQUE (name, "projectId");


--
-- Name: datasets datasets_pkey; Type: CONSTRAINT; Schema: public; Owner: jubilant
--

ALTER TABLE ONLY public.datasets
    ADD CONSTRAINT datasets_pkey PRIMARY KEY (id);


--
-- Name: ds_properties ds_properties_name_datasetid_unique; Type: CONSTRAINT; Schema: public; Owner: jubilant
--

ALTER TABLE ONLY public.ds_properties
    ADD CONSTRAINT ds_properties_name_datasetid_unique UNIQUE (name, "datasetId");


--
-- Name: ds_properties ds_properties_pkey; Type: CONSTRAINT; Schema: public; Owner: jubilant
--

ALTER TABLE ONLY public.ds_properties
    ADD CONSTRAINT ds_properties_pkey PRIMARY KEY (id);


--
-- Name: ds_property_fields ds_property_fields_dspropertyid_formdefid_unique; Type: CONSTRAINT; Schema: public; Owner: jubilant
--

ALTER TABLE ONLY public.ds_property_fields
    ADD CONSTRAINT ds_property_fields_dspropertyid_formdefid_unique UNIQUE ("dsPropertyId", "formDefId");


--
-- Name: ds_property_fields ds_property_fields_dspropertyid_path_formdefid_unique; Type: CONSTRAINT; Schema: public; Owner: jubilant
--

ALTER TABLE ONLY public.ds_property_fields
    ADD CONSTRAINT ds_property_fields_dspropertyid_path_formdefid_unique UNIQUE ("dsPropertyId", path, "formDefId");


--
-- Name: entities entities_pkey; Type: CONSTRAINT; Schema: public; Owner: jubilant
--

ALTER TABLE ONLY public.entities
    ADD CONSTRAINT entities_pkey PRIMARY KEY (id);


--
-- Name: entities entities_uuid_unique; Type: CONSTRAINT; Schema: public; Owner: jubilant
--

ALTER TABLE ONLY public.entities
    ADD CONSTRAINT entities_uuid_unique UNIQUE (uuid);


--
-- Name: entity_def_sources entity_def_sources_pkey; Type: CONSTRAINT; Schema: public; Owner: jubilant
--

ALTER TABLE ONLY public.entity_def_sources
    ADD CONSTRAINT entity_def_sources_pkey PRIMARY KEY (id);


--
-- Name: entity_defs entity_defs_pkey; Type: CONSTRAINT; Schema: public; Owner: jubilant
--

ALTER TABLE ONLY public.entity_defs
    ADD CONSTRAINT entity_defs_pkey PRIMARY KEY (id);


--
-- Name: entity_submission_backlog entity_submission_backlog_branchId_branchBaseVersion_key; Type: CONSTRAINT; Schema: public; Owner: jubilant
--

ALTER TABLE ONLY public.entity_submission_backlog
    ADD CONSTRAINT "entity_submission_backlog_branchId_branchBaseVersion_key" UNIQUE ("branchId", "branchBaseVersion");


--
-- Name: field_keys field_keys_pkey; Type: CONSTRAINT; Schema: public; Owner: jubilant
--

ALTER TABLE ONLY public.field_keys
    ADD CONSTRAINT field_keys_pkey PRIMARY KEY ("actorId");


--
-- Name: form_attachments form_attachments_pkey; Type: CONSTRAINT; Schema: public; Owner: jubilant
--

ALTER TABLE ONLY public.form_attachments
    ADD CONSTRAINT form_attachments_pkey PRIMARY KEY ("formDefId", name);


--
-- Name: form_defs form_defs_pkey; Type: CONSTRAINT; Schema: public; Owner: jubilant
--

ALTER TABLE ONLY public.form_defs
    ADD CONSTRAINT form_defs_pkey PRIMARY KEY (id);


--
-- Name: form_fields form_fields_pkey; Type: CONSTRAINT; Schema: public; Owner: jubilant
--

ALTER TABLE ONLY public.form_fields
    ADD CONSTRAINT form_fields_pkey PRIMARY KEY ("schemaId", path);


--
-- Name: form_schemas form_schemas_pkey; Type: CONSTRAINT; Schema: public; Owner: jubilant
--

ALTER TABLE ONLY public.form_schemas
    ADD CONSTRAINT form_schemas_pkey PRIMARY KEY (id);


--
-- Name: forms forms_pkey; Type: CONSTRAINT; Schema: public; Owner: jubilant
--

ALTER TABLE ONLY public.forms
    ADD CONSTRAINT forms_pkey PRIMARY KEY (id);


--
-- Name: keys keys_pkey; Type: CONSTRAINT; Schema: public; Owner: jubilant
--

ALTER TABLE ONLY public.keys
    ADD CONSTRAINT keys_pkey PRIMARY KEY (id);


--
-- Name: keys keys_public_unique; Type: CONSTRAINT; Schema: public; Owner: jubilant
--

ALTER TABLE ONLY public.keys
    ADD CONSTRAINT keys_public_unique UNIQUE (public);


--
-- Name: knex_migrations_lock knex_migrations_lock_pkey; Type: CONSTRAINT; Schema: public; Owner: jubilant
--

ALTER TABLE ONLY public.knex_migrations_lock
    ADD CONSTRAINT knex_migrations_lock_pkey PRIMARY KEY (index);


--
-- Name: knex_migrations knex_migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: jubilant
--

ALTER TABLE ONLY public.knex_migrations
    ADD CONSTRAINT knex_migrations_pkey PRIMARY KEY (id);


--
-- Name: projects projects_acteeid_unique; Type: CONSTRAINT; Schema: public; Owner: jubilant
--

ALTER TABLE ONLY public.projects
    ADD CONSTRAINT projects_acteeid_unique UNIQUE ("acteeId");


--
-- Name: projects projects_pkey; Type: CONSTRAINT; Schema: public; Owner: jubilant
--

ALTER TABLE ONLY public.projects
    ADD CONSTRAINT projects_pkey PRIMARY KEY (id);


--
-- Name: public_links public_links_pkey; Type: CONSTRAINT; Schema: public; Owner: jubilant
--

ALTER TABLE ONLY public.public_links
    ADD CONSTRAINT public_links_pkey PRIMARY KEY ("actorId");


--
-- Name: purged_entities purged_entities_pkey; Type: CONSTRAINT; Schema: public; Owner: jubilant
--

ALTER TABLE ONLY public.purged_entities
    ADD CONSTRAINT purged_entities_pkey PRIMARY KEY ("entityUuid");


--
-- Name: roles roles_pkey; Type: CONSTRAINT; Schema: public; Owner: jubilant
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_pkey PRIMARY KEY (id);


--
-- Name: submission_attachments submission_attachments_pkey; Type: CONSTRAINT; Schema: public; Owner: jubilant
--

ALTER TABLE ONLY public.submission_attachments
    ADD CONSTRAINT submission_attachments_pkey PRIMARY KEY ("submissionDefId", name);


--
-- Name: submission_defs submission_defs_pkey; Type: CONSTRAINT; Schema: public; Owner: jubilant
--

ALTER TABLE ONLY public.submission_defs
    ADD CONSTRAINT submission_defs_pkey PRIMARY KEY (id);


--
-- Name: submissions submissions_formid_instanceid_draft_unique; Type: CONSTRAINT; Schema: public; Owner: jubilant
--

ALTER TABLE ONLY public.submissions
    ADD CONSTRAINT submissions_formid_instanceid_draft_unique UNIQUE ("formId", "instanceId", draft);


--
-- Name: submissions submissions_pkey; Type: CONSTRAINT; Schema: public; Owner: jubilant
--

ALTER TABLE ONLY public.submissions
    ADD CONSTRAINT submissions_pkey PRIMARY KEY (id);


--
-- Name: user_project_preferences user_project_preferences_primary_key; Type: CONSTRAINT; Schema: public; Owner: jubilant
--

ALTER TABLE ONLY public.user_project_preferences
    ADD CONSTRAINT user_project_preferences_primary_key PRIMARY KEY ("userId", "projectId", "propertyName");


--
-- Name: user_site_preferences user_site_preferences_primary_key; Type: CONSTRAINT; Schema: public; Owner: jubilant
--

ALTER TABLE ONLY public.user_site_preferences
    ADD CONSTRAINT user_site_preferences_primary_key PRIMARY KEY ("userId", "propertyName");


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: jubilant
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY ("actorId");


--
-- Name: actees_parent_index; Type: INDEX; Schema: public; Owner: jubilant
--

CREATE INDEX actees_parent_index ON public.actees USING btree (parent);


--
-- Name: actors_displayname_gist_index; Type: INDEX; Schema: public; Owner: jubilant
--

CREATE INDEX actors_displayname_gist_index ON public.actors USING gist ("displayName" public.gist_trgm_ops);


--
-- Name: actors_type_index; Type: INDEX; Schema: public; Owner: jubilant
--

CREATE INDEX actors_type_index ON public.actors USING btree (type);


--
-- Name: assignments_actorid_index; Type: INDEX; Schema: public; Owner: jubilant
--

CREATE INDEX assignments_actorid_index ON public.assignments USING btree ("actorId");


--
-- Name: audits_acteeid_loggedat_index; Type: INDEX; Schema: public; Owner: jubilant
--

CREATE INDEX audits_acteeid_loggedat_index ON public.audits USING btree ("acteeId", "loggedAt");


--
-- Name: audits_action_acteeid_loggedat_index; Type: INDEX; Schema: public; Owner: jubilant
--

CREATE INDEX audits_action_acteeid_loggedat_index ON public.audits USING btree (action, "acteeId", "loggedAt");


--
-- Name: audits_actorid_action_loggedat_index; Type: INDEX; Schema: public; Owner: jubilant
--

CREATE INDEX audits_actorid_action_loggedat_index ON public.audits USING btree ("actorId", action, "loggedAt");


--
-- Name: audits_actorid_loggedat_index; Type: INDEX; Schema: public; Owner: jubilant
--

CREATE INDEX audits_actorid_loggedat_index ON public.audits USING btree ("actorId", "loggedAt");


--
-- Name: audits_claimed_processed_index; Type: INDEX; Schema: public; Owner: jubilant
--

CREATE INDEX audits_claimed_processed_index ON public.audits USING btree (claimed, processed);


--
-- Name: audits_details_entity_def_index; Type: INDEX; Schema: public; Owner: jubilant
--

CREATE INDEX audits_details_entity_def_index ON public.audits USING hash ((((details ->> 'entityDefId'::text))::integer));


--
-- Name: audits_details_entity_index; Type: INDEX; Schema: public; Owner: jubilant
--

CREATE INDEX audits_details_entity_index ON public.audits USING hash ((((details ->> 'entityId'::text))::integer));


--
-- Name: audits_details_entity_source_index; Type: INDEX; Schema: public; Owner: jubilant
--

CREATE INDEX audits_details_entity_source_index ON public.audits USING hash ((((details ->> 'sourceId'::text))::integer));


--
-- Name: audits_details_entity_uuid; Type: INDEX; Schema: public; Owner: jubilant
--

CREATE INDEX audits_details_entity_uuid ON public.audits USING hash ((((details -> 'entity'::text) ->> 'uuid'::text))) WHERE (action = ANY (ARRAY['entity.create'::text, 'entity.update'::text, 'entity.update.version'::text, 'entity.update.resolve'::text, 'entity.delete'::text, 'entity.restore'::text]));


--
-- Name: audits_details_entity_uuid_index; Type: INDEX; Schema: public; Owner: jubilant
--

CREATE INDEX audits_details_entity_uuid_index ON public.audits USING hash ((((details -> 'entity'::text) ->> 'uuid'::text)));


--
-- Name: audits_details_entityuuids; Type: INDEX; Schema: public; Owner: jubilant
--

CREATE INDEX audits_details_entityuuids ON public.audits USING gin (((details -> 'entityUuids'::text)) jsonb_path_ops) WHERE (action = 'entity.purge'::text);


--
-- Name: audits_details_submission_index; Type: INDEX; Schema: public; Owner: jubilant
--

CREATE INDEX audits_details_submission_index ON public.audits USING hash ((((details -> 'submissionId'::text))::integer));


--
-- Name: blobs_sha_index; Type: INDEX; Schema: public; Owner: jubilant
--

CREATE INDEX blobs_sha_index ON public.blobs USING btree (sha);


--
-- Name: client_audits_start_index; Type: INDEX; Schema: public; Owner: jubilant
--

CREATE INDEX client_audits_start_index ON public.client_audits USING btree (start);


--
-- Name: comments_submissionid_index; Type: INDEX; Schema: public; Owner: jubilant
--

CREATE INDEX comments_submissionid_index ON public.comments USING btree ("submissionId");


--
-- Name: entities_datasetid_createdat_id_index; Type: INDEX; Schema: public; Owner: jubilant
--

CREATE INDEX entities_datasetid_createdat_id_index ON public.entities USING btree ("datasetId", "createdAt", id);


--
-- Name: entities_deletedat_index; Type: INDEX; Schema: public; Owner: jubilant
--

CREATE INDEX entities_deletedat_index ON public.entities USING btree ("deletedAt");


--
-- Name: entity_defs_entityid_current_index; Type: INDEX; Schema: public; Owner: jubilant
--

CREATE INDEX entity_defs_entityid_current_index ON public.entity_defs USING btree ("entityId", current);


--
-- Name: entity_defs_sourceid_index; Type: INDEX; Schema: public; Owner: jubilant
--

CREATE INDEX entity_defs_sourceid_index ON public.entity_defs USING btree ("sourceId");


--
-- Name: field_keys_actorid_projectid_index; Type: INDEX; Schema: public; Owner: jubilant
--

CREATE INDEX field_keys_actorid_projectid_index ON public.field_keys USING btree ("actorId", "projectId");


--
-- Name: form_attachments_formid_index; Type: INDEX; Schema: public; Owner: jubilant
--

CREATE INDEX form_attachments_formid_index ON public.form_attachments USING btree ("formId");


--
-- Name: form_defs_formid_publishedat_index; Type: INDEX; Schema: public; Owner: jubilant
--

CREATE INDEX form_defs_formid_publishedat_index ON public.form_defs USING btree ("formId", "publishedAt");


--
-- Name: form_field_values_formid_index; Type: INDEX; Schema: public; Owner: jubilant
--

CREATE INDEX form_field_values_formid_index ON public.form_field_values USING btree ("formId");


--
-- Name: form_field_values_formid_submissiondefid_path_index; Type: INDEX; Schema: public; Owner: jubilant
--

CREATE INDEX form_field_values_formid_submissiondefid_path_index ON public.form_field_values USING btree ("formId", "submissionDefId", path);


--
-- Name: form_field_values_submissiondefid_index; Type: INDEX; Schema: public; Owner: jubilant
--

CREATE INDEX form_field_values_submissiondefid_index ON public.form_field_values USING btree ("submissionDefId");


--
-- Name: form_fields_formid_path_type_index; Type: INDEX; Schema: public; Owner: jubilant
--

CREATE INDEX form_fields_formid_path_type_index ON public.form_fields USING btree ("formId", path, type);


--
-- Name: form_fields_schemaid_binary_index; Type: INDEX; Schema: public; Owner: jubilant
--

CREATE INDEX form_fields_schemaid_binary_index ON public.form_fields USING btree ("schemaId", "binary");


--
-- Name: form_fields_schemaid_order_index; Type: INDEX; Schema: public; Owner: jubilant
--

CREATE INDEX form_fields_schemaid_order_index ON public.form_fields USING btree ("schemaId", "order");


--
-- Name: forms_deletedat_state_index; Type: INDEX; Schema: public; Owner: jubilant
--

CREATE INDEX forms_deletedat_state_index ON public.forms USING btree ("deletedAt", state);


--
-- Name: forms_projectid_xmlformid_deletedat_unique; Type: INDEX; Schema: public; Owner: jubilant
--

CREATE UNIQUE INDEX forms_projectid_xmlformid_deletedat_unique ON public.forms USING btree ("projectId", "xmlFormId") WHERE ("deletedAt" IS NULL);


--
-- Name: forms_xmlformid_index; Type: INDEX; Schema: public; Owner: jubilant
--

CREATE INDEX forms_xmlformid_index ON public.forms USING btree ("xmlFormId");


--
-- Name: keys_public_index; Type: INDEX; Schema: public; Owner: jubilant
--

CREATE INDEX keys_public_index ON public.keys USING btree (public);


--
-- Name: purged_entities_actee_uuid_index; Type: INDEX; Schema: public; Owner: jubilant
--

CREATE INDEX purged_entities_actee_uuid_index ON public.purged_entities USING btree ("acteeId", "entityUuid");


--
-- Name: roles_verbs_gin_index; Type: INDEX; Schema: public; Owner: jubilant
--

CREATE INDEX roles_verbs_gin_index ON public.roles USING gin (verbs jsonb_path_ops);


--
-- Name: sessions_actorid_expires_index; Type: INDEX; Schema: public; Owner: jubilant
--

CREATE INDEX sessions_actorid_expires_index ON public.sessions USING btree ("actorId", "expiresAt");


--
-- Name: sessions_token_index; Type: INDEX; Schema: public; Owner: jubilant
--

CREATE UNIQUE INDEX sessions_token_index ON public.sessions USING btree (token);


--
-- Name: submission_defs_createdat_id_index; Type: INDEX; Schema: public; Owner: jubilant
--

CREATE INDEX submission_defs_createdat_id_index ON public.submission_defs USING btree ("createdAt", id);


--
-- Name: submission_defs_submissionid_current_index; Type: INDEX; Schema: public; Owner: jubilant
--

CREATE INDEX submission_defs_submissionid_current_index ON public.submission_defs USING btree ("submissionId", current);


--
-- Name: submission_defs_submissionid_instanceid_index; Type: INDEX; Schema: public; Owner: jubilant
--

CREATE INDEX submission_defs_submissionid_instanceid_index ON public.submission_defs USING btree ("submissionId", "instanceId");


--
-- Name: submissions_formid_createdat_id_index; Type: INDEX; Schema: public; Owner: jubilant
--

CREATE INDEX submissions_formid_createdat_id_index ON public.submissions USING btree ("formId", "createdAt", id);


--
-- Name: user_project_preferences_userId_idx; Type: INDEX; Schema: public; Owner: jubilant
--

CREATE INDEX "user_project_preferences_userId_idx" ON public.user_project_preferences USING btree ("userId");


--
-- Name: user_site_preferences_userId_idx; Type: INDEX; Schema: public; Owner: jubilant
--

CREATE INDEX "user_site_preferences_userId_idx" ON public.user_site_preferences USING btree ("userId");


--
-- Name: users_email_gist_index; Type: INDEX; Schema: public; Owner: jubilant
--

CREATE INDEX users_email_gist_index ON public.users USING gist (email public.gist_trgm_ops);


--
-- Name: users_email_index; Type: INDEX; Schema: public; Owner: jubilant
--

CREATE INDEX users_email_index ON public.users USING btree (email);


--
-- Name: users check_email; Type: TRIGGER; Schema: public; Owner: jubilant
--

CREATE TRIGGER check_email BEFORE INSERT OR UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION public.check_email();


--
-- Name: forms check_form_state; Type: TRIGGER; Schema: public; Owner: jubilant
--

CREATE TRIGGER check_form_state BEFORE INSERT OR UPDATE ON public.forms FOR EACH ROW EXECUTE FUNCTION public.check_form_state();


--
-- Name: form_defs check_form_version; Type: TRIGGER; Schema: public; Owner: jubilant
--

CREATE TRIGGER check_form_version AFTER INSERT OR UPDATE ON public.form_defs FOR EACH ROW EXECUTE FUNCTION public.check_form_version();


--
-- Name: submission_defs check_instanceid_unique; Type: TRIGGER; Schema: public; Owner: jubilant
--

CREATE TRIGGER check_instanceid_unique AFTER INSERT ON public.submission_defs FOR EACH ROW EXECUTE FUNCTION public.check_instanceid_unique();


--
-- Name: form_defs check_managed_key; Type: TRIGGER; Schema: public; Owner: jubilant
--

CREATE TRIGGER check_managed_key AFTER INSERT OR UPDATE ON public.form_defs FOR EACH ROW EXECUTE FUNCTION public.check_managed_key();


--
-- Name: submissions check_review_state; Type: TRIGGER; Schema: public; Owner: jubilant
--

CREATE TRIGGER check_review_state BEFORE INSERT OR UPDATE ON public.submissions FOR EACH ROW EXECUTE FUNCTION public.check_review_state();


--
-- Name: actors actors_acteeid_foreign; Type: FK CONSTRAINT; Schema: public; Owner: jubilant
--

ALTER TABLE ONLY public.actors
    ADD CONSTRAINT actors_acteeid_foreign FOREIGN KEY ("acteeId") REFERENCES public.actees(id);


--
-- Name: assignments assignments_acteeid_foreign; Type: FK CONSTRAINT; Schema: public; Owner: jubilant
--

ALTER TABLE ONLY public.assignments
    ADD CONSTRAINT assignments_acteeid_foreign FOREIGN KEY ("acteeId") REFERENCES public.actees(id);


--
-- Name: assignments assignments_actorid_foreign; Type: FK CONSTRAINT; Schema: public; Owner: jubilant
--

ALTER TABLE ONLY public.assignments
    ADD CONSTRAINT assignments_actorid_foreign FOREIGN KEY ("actorId") REFERENCES public.actors(id);


--
-- Name: assignments assignments_roleid_foreign; Type: FK CONSTRAINT; Schema: public; Owner: jubilant
--

ALTER TABLE ONLY public.assignments
    ADD CONSTRAINT assignments_roleid_foreign FOREIGN KEY ("roleId") REFERENCES public.roles(id);


--
-- Name: submission_attachments attachments_blobid_foreign; Type: FK CONSTRAINT; Schema: public; Owner: jubilant
--

ALTER TABLE ONLY public.submission_attachments
    ADD CONSTRAINT attachments_blobid_foreign FOREIGN KEY ("blobId") REFERENCES public.blobs(id);


--
-- Name: audits audits_acteeid_foreign; Type: FK CONSTRAINT; Schema: public; Owner: jubilant
--

ALTER TABLE ONLY public.audits
    ADD CONSTRAINT audits_acteeid_foreign FOREIGN KEY ("acteeId") REFERENCES public.actees(id);


--
-- Name: audits audits_actorid_foreign; Type: FK CONSTRAINT; Schema: public; Owner: jubilant
--

ALTER TABLE ONLY public.audits
    ADD CONSTRAINT audits_actorid_foreign FOREIGN KEY ("actorId") REFERENCES public.actors(id);


--
-- Name: client_audits client_audits_blobid_foreign; Type: FK CONSTRAINT; Schema: public; Owner: jubilant
--

ALTER TABLE ONLY public.client_audits
    ADD CONSTRAINT client_audits_blobid_foreign FOREIGN KEY ("blobId") REFERENCES public.blobs(id);


--
-- Name: comments comments_actorid_foreign; Type: FK CONSTRAINT; Schema: public; Owner: jubilant
--

ALTER TABLE ONLY public.comments
    ADD CONSTRAINT comments_actorid_foreign FOREIGN KEY ("actorId") REFERENCES public.actors(id);


--
-- Name: comments comments_submissionid_foreign; Type: FK CONSTRAINT; Schema: public; Owner: jubilant
--

ALTER TABLE ONLY public.comments
    ADD CONSTRAINT comments_submissionid_foreign FOREIGN KEY ("submissionId") REFERENCES public.submissions(id) ON DELETE CASCADE;


--
-- Name: dataset_form_defs dataset_form_defs_datasetid_foreign; Type: FK CONSTRAINT; Schema: public; Owner: jubilant
--

ALTER TABLE ONLY public.dataset_form_defs
    ADD CONSTRAINT dataset_form_defs_datasetid_foreign FOREIGN KEY ("datasetId") REFERENCES public.datasets(id);


--
-- Name: dataset_form_defs dataset_form_defs_formdefid_foreign; Type: FK CONSTRAINT; Schema: public; Owner: jubilant
--

ALTER TABLE ONLY public.dataset_form_defs
    ADD CONSTRAINT dataset_form_defs_formdefid_foreign FOREIGN KEY ("formDefId") REFERENCES public.form_defs(id) ON DELETE CASCADE;


--
-- Name: datasets datasets_projectid_foreign; Type: FK CONSTRAINT; Schema: public; Owner: jubilant
--

ALTER TABLE ONLY public.datasets
    ADD CONSTRAINT datasets_projectid_foreign FOREIGN KEY ("projectId") REFERENCES public.projects(id);


--
-- Name: ds_properties ds_properties_datasetid_foreign; Type: FK CONSTRAINT; Schema: public; Owner: jubilant
--

ALTER TABLE ONLY public.ds_properties
    ADD CONSTRAINT ds_properties_datasetid_foreign FOREIGN KEY ("datasetId") REFERENCES public.datasets(id);


--
-- Name: ds_property_fields ds_property_fields_dspropertyid_foreign; Type: FK CONSTRAINT; Schema: public; Owner: jubilant
--

ALTER TABLE ONLY public.ds_property_fields
    ADD CONSTRAINT ds_property_fields_dspropertyid_foreign FOREIGN KEY ("dsPropertyId") REFERENCES public.ds_properties(id);


--
-- Name: entities entities_createdby_foreign; Type: FK CONSTRAINT; Schema: public; Owner: jubilant
--

ALTER TABLE ONLY public.entities
    ADD CONSTRAINT entities_createdby_foreign FOREIGN KEY ("creatorId") REFERENCES public.actors(id);


--
-- Name: entities entities_datasetid_foreign; Type: FK CONSTRAINT; Schema: public; Owner: jubilant
--

ALTER TABLE ONLY public.entities
    ADD CONSTRAINT entities_datasetid_foreign FOREIGN KEY ("datasetId") REFERENCES public.datasets(id);


--
-- Name: entity_def_sources entity_def_sources_auditid_foreign; Type: FK CONSTRAINT; Schema: public; Owner: jubilant
--

ALTER TABLE ONLY public.entity_def_sources
    ADD CONSTRAINT entity_def_sources_auditid_foreign FOREIGN KEY ("auditId") REFERENCES public.audits(id) ON DELETE SET NULL;


--
-- Name: entity_def_sources entity_def_sources_submissiondefid_foreign; Type: FK CONSTRAINT; Schema: public; Owner: jubilant
--

ALTER TABLE ONLY public.entity_def_sources
    ADD CONSTRAINT entity_def_sources_submissiondefid_foreign FOREIGN KEY ("submissionDefId") REFERENCES public.submission_defs(id) ON DELETE SET NULL;


--
-- Name: entity_defs entity_defs_entityid_foreign; Type: FK CONSTRAINT; Schema: public; Owner: jubilant
--

ALTER TABLE ONLY public.entity_defs
    ADD CONSTRAINT entity_defs_entityid_foreign FOREIGN KEY ("entityId") REFERENCES public.entities(id) ON DELETE CASCADE;


--
-- Name: entity_defs entity_defs_sourceid_foreign; Type: FK CONSTRAINT; Schema: public; Owner: jubilant
--

ALTER TABLE ONLY public.entity_defs
    ADD CONSTRAINT entity_defs_sourceid_foreign FOREIGN KEY ("sourceId") REFERENCES public.entity_def_sources(id);


--
-- Name: field_keys field_keys_actorid_foreign; Type: FK CONSTRAINT; Schema: public; Owner: jubilant
--

ALTER TABLE ONLY public.field_keys
    ADD CONSTRAINT field_keys_actorid_foreign FOREIGN KEY ("actorId") REFERENCES public.actors(id);


--
-- Name: field_keys field_keys_createdby_foreign; Type: FK CONSTRAINT; Schema: public; Owner: jubilant
--

ALTER TABLE ONLY public.field_keys
    ADD CONSTRAINT field_keys_createdby_foreign FOREIGN KEY ("createdBy") REFERENCES public.actors(id);


--
-- Name: field_keys field_keys_projectid_foreign; Type: FK CONSTRAINT; Schema: public; Owner: jubilant
--

ALTER TABLE ONLY public.field_keys
    ADD CONSTRAINT field_keys_projectid_foreign FOREIGN KEY ("projectId") REFERENCES public.projects(id);


--
-- Name: entity_submission_backlog fk_audit_id; Type: FK CONSTRAINT; Schema: public; Owner: jubilant
--

ALTER TABLE ONLY public.entity_submission_backlog
    ADD CONSTRAINT fk_audit_id FOREIGN KEY ("auditId") REFERENCES public.audits(id) ON DELETE CASCADE;


--
-- Name: entity_submission_backlog fk_submission_defs; Type: FK CONSTRAINT; Schema: public; Owner: jubilant
--

ALTER TABLE ONLY public.entity_submission_backlog
    ADD CONSTRAINT fk_submission_defs FOREIGN KEY ("submissionDefId") REFERENCES public.submission_defs(id) ON DELETE CASCADE;


--
-- Name: entity_submission_backlog fk_submissions; Type: FK CONSTRAINT; Schema: public; Owner: jubilant
--

ALTER TABLE ONLY public.entity_submission_backlog
    ADD CONSTRAINT fk_submissions FOREIGN KEY ("submissionId") REFERENCES public.submissions(id) ON DELETE CASCADE;


--
-- Name: form_attachments form_attachments_blobid_foreign; Type: FK CONSTRAINT; Schema: public; Owner: jubilant
--

ALTER TABLE ONLY public.form_attachments
    ADD CONSTRAINT form_attachments_blobid_foreign FOREIGN KEY ("blobId") REFERENCES public.blobs(id);


--
-- Name: form_attachments form_attachments_datasetid_foreign; Type: FK CONSTRAINT; Schema: public; Owner: jubilant
--

ALTER TABLE ONLY public.form_attachments
    ADD CONSTRAINT form_attachments_datasetid_foreign FOREIGN KEY ("datasetId") REFERENCES public.datasets(id);


--
-- Name: form_attachments form_attachments_formdefid_foreign; Type: FK CONSTRAINT; Schema: public; Owner: jubilant
--

ALTER TABLE ONLY public.form_attachments
    ADD CONSTRAINT form_attachments_formdefid_foreign FOREIGN KEY ("formDefId") REFERENCES public.form_defs(id) ON DELETE CASCADE;


--
-- Name: form_attachments form_attachments_formid_foreign; Type: FK CONSTRAINT; Schema: public; Owner: jubilant
--

ALTER TABLE ONLY public.form_attachments
    ADD CONSTRAINT form_attachments_formid_foreign FOREIGN KEY ("formId") REFERENCES public.forms(id) ON DELETE CASCADE;


--
-- Name: form_defs form_defs_formid_foreign; Type: FK CONSTRAINT; Schema: public; Owner: jubilant
--

ALTER TABLE ONLY public.form_defs
    ADD CONSTRAINT form_defs_formid_foreign FOREIGN KEY ("formId") REFERENCES public.forms(id) ON DELETE CASCADE;


--
-- Name: form_defs form_defs_keyid_foreign; Type: FK CONSTRAINT; Schema: public; Owner: jubilant
--

ALTER TABLE ONLY public.form_defs
    ADD CONSTRAINT form_defs_keyid_foreign FOREIGN KEY ("keyId") REFERENCES public.keys(id);


--
-- Name: form_defs form_defs_schemaid_foreign; Type: FK CONSTRAINT; Schema: public; Owner: jubilant
--

ALTER TABLE ONLY public.form_defs
    ADD CONSTRAINT form_defs_schemaid_foreign FOREIGN KEY ("schemaId") REFERENCES public.form_schemas(id);


--
-- Name: form_defs form_defs_xlsblobid_foreign; Type: FK CONSTRAINT; Schema: public; Owner: jubilant
--

ALTER TABLE ONLY public.form_defs
    ADD CONSTRAINT form_defs_xlsblobid_foreign FOREIGN KEY ("xlsBlobId") REFERENCES public.blobs(id);


--
-- Name: form_field_values form_field_values_formid_foreign; Type: FK CONSTRAINT; Schema: public; Owner: jubilant
--

ALTER TABLE ONLY public.form_field_values
    ADD CONSTRAINT form_field_values_formid_foreign FOREIGN KEY ("formId") REFERENCES public.forms(id) ON DELETE CASCADE;


--
-- Name: form_field_values form_field_values_submissiondefid_foreign; Type: FK CONSTRAINT; Schema: public; Owner: jubilant
--

ALTER TABLE ONLY public.form_field_values
    ADD CONSTRAINT form_field_values_submissiondefid_foreign FOREIGN KEY ("submissionDefId") REFERENCES public.submission_defs(id) ON DELETE CASCADE;


--
-- Name: form_fields form_fields_formid_foreign; Type: FK CONSTRAINT; Schema: public; Owner: jubilant
--

ALTER TABLE ONLY public.form_fields
    ADD CONSTRAINT form_fields_formid_foreign FOREIGN KEY ("formId") REFERENCES public.forms(id) ON DELETE CASCADE;


--
-- Name: form_fields form_fields_schemaid_foreign; Type: FK CONSTRAINT; Schema: public; Owner: jubilant
--

ALTER TABLE ONLY public.form_fields
    ADD CONSTRAINT form_fields_schemaid_foreign FOREIGN KEY ("schemaId") REFERENCES public.form_schemas(id) ON DELETE CASCADE;


--
-- Name: forms forms_acteeid_foreign; Type: FK CONSTRAINT; Schema: public; Owner: jubilant
--

ALTER TABLE ONLY public.forms
    ADD CONSTRAINT forms_acteeid_foreign FOREIGN KEY ("acteeId") REFERENCES public.actees(id);


--
-- Name: forms forms_currentdefid_foreign; Type: FK CONSTRAINT; Schema: public; Owner: jubilant
--

ALTER TABLE ONLY public.forms
    ADD CONSTRAINT forms_currentdefid_foreign FOREIGN KEY ("currentDefId") REFERENCES public.form_defs(id);


--
-- Name: forms forms_draftdefid_foreign; Type: FK CONSTRAINT; Schema: public; Owner: jubilant
--

ALTER TABLE ONLY public.forms
    ADD CONSTRAINT forms_draftdefid_foreign FOREIGN KEY ("draftDefId") REFERENCES public.form_defs(id);


--
-- Name: forms forms_projectid_foreign; Type: FK CONSTRAINT; Schema: public; Owner: jubilant
--

ALTER TABLE ONLY public.forms
    ADD CONSTRAINT forms_projectid_foreign FOREIGN KEY ("projectId") REFERENCES public.projects(id);


--
-- Name: projects projects_keyid_foreign; Type: FK CONSTRAINT; Schema: public; Owner: jubilant
--

ALTER TABLE ONLY public.projects
    ADD CONSTRAINT projects_keyid_foreign FOREIGN KEY ("keyId") REFERENCES public.keys(id);


--
-- Name: public_links public_links_actorid_foreign; Type: FK CONSTRAINT; Schema: public; Owner: jubilant
--

ALTER TABLE ONLY public.public_links
    ADD CONSTRAINT public_links_actorid_foreign FOREIGN KEY ("actorId") REFERENCES public.actors(id);


--
-- Name: public_links public_links_createdby_foreign; Type: FK CONSTRAINT; Schema: public; Owner: jubilant
--

ALTER TABLE ONLY public.public_links
    ADD CONSTRAINT public_links_createdby_foreign FOREIGN KEY ("createdBy") REFERENCES public.actors(id);


--
-- Name: public_links public_links_formid_foreign; Type: FK CONSTRAINT; Schema: public; Owner: jubilant
--

ALTER TABLE ONLY public.public_links
    ADD CONSTRAINT public_links_formid_foreign FOREIGN KEY ("formId") REFERENCES public.forms(id) ON DELETE CASCADE;


--
-- Name: sessions sessions_actorid_foreign; Type: FK CONSTRAINT; Schema: public; Owner: jubilant
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_actorid_foreign FOREIGN KEY ("actorId") REFERENCES public.actors(id);


--
-- Name: submission_attachments submission_attachments_submissiondefid_foreign; Type: FK CONSTRAINT; Schema: public; Owner: jubilant
--

ALTER TABLE ONLY public.submission_attachments
    ADD CONSTRAINT submission_attachments_submissiondefid_foreign FOREIGN KEY ("submissionDefId") REFERENCES public.submission_defs(id) ON DELETE CASCADE;


--
-- Name: submission_defs submission_defs_actorid_foreign; Type: FK CONSTRAINT; Schema: public; Owner: jubilant
--

ALTER TABLE ONLY public.submission_defs
    ADD CONSTRAINT submission_defs_actorid_foreign FOREIGN KEY ("submitterId") REFERENCES public.actors(id);


--
-- Name: submission_defs submission_defs_formdefid_foreign; Type: FK CONSTRAINT; Schema: public; Owner: jubilant
--

ALTER TABLE ONLY public.submission_defs
    ADD CONSTRAINT submission_defs_formdefid_foreign FOREIGN KEY ("formDefId") REFERENCES public.form_defs(id) ON DELETE CASCADE;


--
-- Name: submission_defs submission_defs_submissionid_foreign; Type: FK CONSTRAINT; Schema: public; Owner: jubilant
--

ALTER TABLE ONLY public.submission_defs
    ADD CONSTRAINT submission_defs_submissionid_foreign FOREIGN KEY ("submissionId") REFERENCES public.submissions(id) ON DELETE CASCADE;


--
-- Name: submissions submissions_formid_foreign; Type: FK CONSTRAINT; Schema: public; Owner: jubilant
--

ALTER TABLE ONLY public.submissions
    ADD CONSTRAINT submissions_formid_foreign FOREIGN KEY ("formId") REFERENCES public.forms(id) ON DELETE CASCADE;


--
-- Name: submissions submissions_submitter_foreign; Type: FK CONSTRAINT; Schema: public; Owner: jubilant
--

ALTER TABLE ONLY public.submissions
    ADD CONSTRAINT submissions_submitter_foreign FOREIGN KEY ("submitterId") REFERENCES public.actors(id);


--
-- Name: user_project_preferences user_project_preferences_projectId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: jubilant
--

ALTER TABLE ONLY public.user_project_preferences
    ADD CONSTRAINT "user_project_preferences_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES public.projects(id);


--
-- Name: user_project_preferences user_project_preferences_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: jubilant
--

ALTER TABLE ONLY public.user_project_preferences
    ADD CONSTRAINT "user_project_preferences_userId_fkey" FOREIGN KEY ("userId") REFERENCES public.users("actorId");


--
-- Name: user_site_preferences user_site_preferences_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: jubilant
--

ALTER TABLE ONLY public.user_site_preferences
    ADD CONSTRAINT "user_site_preferences_userId_fkey" FOREIGN KEY ("userId") REFERENCES public.users("actorId");


--
-- Name: users users_actorid_foreign; Type: FK CONSTRAINT; Schema: public; Owner: jubilant
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_actorid_foreign FOREIGN KEY ("actorId") REFERENCES public.actors(id);


--
-- Name: SCHEMA public; Type: ACL; Schema: -; Owner: postgres
--

REVOKE USAGE ON SCHEMA public FROM PUBLIC;
GRANT ALL ON SCHEMA public TO PUBLIC;


--
-- PostgreSQL database dump complete
--

