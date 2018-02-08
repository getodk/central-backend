const { merge } = require('ramda');
const { parse, render } = require('mustache');
const config = require('config');

////////////////////////////////////////////////////////////////////////////////
// SETUP

// set up some basic information needed later: env vars are available to every
// template.
const env = config.get('default.env');

// simple helper that precompiles the templates and merges the given data with env.
const template = (body) => {
  parse(body); // caches template for future perf.
  return (data) => render(body, merge(env, data));
};


////////////////////////////////////////////////////////////////////////////////
// MESSAGES
// Not every message for OData actually involves mustache templating.

const xmlServiceTemplate = template(`<?xml version="1.0" encoding="UTF-8"?>
<app:service xmlns:app="http://www.w3.org/2007/app" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:metadata="http://docs.oasis-open.org/odata/ns/metadata" metadata:context="{{{domain}}}{{{formUrl}}}/$metadata">
  <app:workspace>
    <atom:title type="text">{{form.name}}</atom:title>
    <app:collection href="Records">
      <atom:title type="text">Records</atom:title>
    </app:collection>
    {{#tables}}
    <app:collection href="{{.}}">
      <atom:title type="text">{{.}}</atom:title>
    </app:collection>
    {{/tables}}
  </app:workspace>
</app:service>`);
const xmlServiceDocumentFor = (form, formUrl) => xmlServiceTemplate({ form, formUrl, tables: form.tables() });

const jsonServiceDocumentFor = (form, formUrl) => ({
  '@odata.context': `${env.domain}${formUrl}/$metadata`,
  value: [ 'Records' ].concat(form.tables())
    .map((table) => ({ name: table, kind: 'EntitySet', url: table }))
});

////////////////////////////////////////
// EDMX metadata document
const fqdnBase = 'org.opendatakit.user';
const edmxTemplater = template(`<?xml version="1.0" encoding="UTF-8"?>
<edmx:Edmx xmlns:edmx="http://docs.oasis-open.org/odata/ns/edmx" Version="4.0">
  <edmx:DataServices>
    <Schema xmlns="http://docs.oasis-open.org/odata/ns/edm" Namespace="{{fqdnBase}}.{{form.xmlFormId}}">
    {{#entityTypes}}
      <EntityType Name="{{name}}">
        <Key><PropertyRef Name="{{key}}"/></Key>
      {{#properties}}
        <Property Name="{{name}}" Type="{{type}}"/>
      {{/properties}}
      </EntityType>
    {{/entityTypes}}
    {{#complexTypes}}
      <ComplexType Name="{{name}}">
      {{#properties}}
        <Property Name="{{name}}" Type="{{type}}"/>
      {{/properties}}
      </ComplexType>
    {{/complexTypes}}
      <EntityContainer Name="{{form.xmlFormId}}">
      {{#entityTypes}}
        <EntitySet Name="{{name}}" EntityType="{{fqdnBase}}.{{form.xmlFormId}}.{{name}}"/>
      {{/entityTypes}}
      </EntityContainer>
    </Schema>
  </edmx:DataServices>
</edmx:Edmx>`);

// converts a single primitive field into a Property databag for templating.
const typeMap = { int: 'Edm.Int64', decimal: 'Edm.Decimal', geopoint: 'Edm.GeographyPoint' };
const fieldToProperty = (field) => ({ name: field.name, type: (typeMap[field.type] || 'Edm.String') });

// recursively translates a set of fields representing a "table" (root or repeat
// contents) into an EntityType databag for templating.
const fieldsToEdmx = (fields, path = []) => {
  const properties = [];
  const entityTypes = [];
  const complexTypes = [];

  for (const field of fields) {
    if (Array.isArray(field.children)) {
      const subpath = path.concat(field.name);
      const result = fieldsToEdmx(field.children, subpath);

      entityTypes.push(...result.entityTypes);
      complexTypes.push(...result.complexTypes);

      const fqdnPart = subpath.join('.');
      if (field.type === 'structure') {
        complexTypes.push({ name: fqdnPart, properties: result.properties });
        properties.push({ name: field.name, type: `${fqdnBase}.${fqdnPart}` });
      } else if (field.type === 'repeat') {
        entityTypes.push({ name: fqdnPart, key: '__id', properties: result.properties });
        properties.push({ name: field.name, type: `Collection(${fqdnBase}.${fqdnPart})` });
      }
    } else {
      properties.push(fieldToProperty(field));
    }
  }

  // we return the properties associated with the level we were asked to iterate,
  // along with any sub-entityTypes and sub-complexTypes bubbled up via recursion.
  return { properties, entityTypes, complexTypes };
};

const edmxFor = (form) => {
  const { properties, entityTypes, complexTypes } = fieldsToEdmx(form.schema());
  entityTypes.unshift({ name: 'Records', key: 'meta.instanceID', properties });
  return edmxTemplater({ form, entityTypes, complexTypes, fqdnBase });
};


module.exports = { xmlServiceDocumentFor, jsonServiceDocumentFor, edmxFor };

