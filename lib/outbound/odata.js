const { Readable, Transform } = require('stream');
const config = require('config');
const { merge } = require('ramda');
const { parse, render } = require('mustache');
const { unwrapSubmission } = require('../data/xml');

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
const fqdnRoot = 'org.opendatakit.user';
const edmxTemplater = template(`<?xml version="1.0" encoding="UTF-8"?>
<edmx:Edmx xmlns:edmx="http://docs.oasis-open.org/odata/ns/edmx" Version="4.0">
  <edmx:DataServices>
    <Schema xmlns="http://docs.oasis-open.org/odata/ns/edm" Namespace="{{fqdnBase}}">
    {{#entityTypes}}
      <EntityType Name="{{name}}">
        <Key><PropertyRef Name="{{key}}"/></Key>
        <Property Name="__id" Type="Edm.String"/>
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
        <EntitySet Name="{{name}}" EntityType="{{fqdnBase}}.{{name}}"/>
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
const fieldsToEdmx = (fields, fqdnBase, path = []) => {
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
  const fqdnBase = `${fqdnRoot}.${form.xmlFormId}`;
  const { properties, entityTypes, complexTypes } = fieldsToEdmx(form.schema(), fqdnBase);
  entityTypes.unshift({ name: 'Records', key: '__id', properties });
  return edmxTemplater({ form, entityTypes, complexTypes, fqdnBase });
};


////////////////////////////////////////
// ATOM DATA FEED

// we deliberately strip indentation from this output since we can't really guarantee
// good indentation of the inner xml data without doing a lot of parsing work.
const stripWhitespace = (x) => x.replace(/\n */g, '');
const atomDataPreamble = template(stripWhitespace(`<?xml version="1.0" encoding="UTF-8"?>
<atom:feed xmlns="http://docs.oasis-open.org/odata/ns/data" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:meta="http://docs.oasis-open.org/odata/ns/metadata" xmlns:orx="http://openrosa.org/xforms" meta:context="{{{domain}}}{{{formUrl}}}/$metadata#Records">
  <atom:id>{{{domain}}}{{{formUrl}}}</atom:id>`));
const atomDataEntry = template(stripWhitespace(`<atom:entry>
  <atom:id>{{{domain}}}{{{formUrl}}}('{{row.instanceId}}')</atom:id>
  <atom:title>{{row.instanceId}}</atom:title>
  <atom:summary/>
  <atom:updated>{{createdAt}}</atom:updated>
  <atom:author><atom:name>{{row.submitter}}</atom:name></atom:author>
  <atom:category scheme="http://docs.oasis-open.org/odata/ns/scheme" term="#org.opendatakit.user.{{form.id}}"/>
  <atom:content type="application/xml">
    <meta:properties>
      <__id>{{sequentialId}}</__id>
      {{{properties}}}
    </meta:properties>
  </atom:content>
</atom:entry>`));

const rowStreamToAtom = (form, formUrl, inStream) => {
  // write the header, then transform and stream each row.
  let wroteHeader = false;
  let sequentialId = 0;
  const parserStream = new Transform({
    writableObjectMode: true,
    readableObjectMode: false,
    transform(row, _, done) {
      // first see if we have to write a header out (TODO: is there a cleverer way?)
      if (wroteHeader === false) {
        this.push(atomDataPreamble({ form, formUrl }));
        wroteHeader = true;
      }

      // do transformation on the xml to strip the outer layers.
      sequentialId++;
      unwrapSubmission(row).then((unwrapped) => {
        this.push(atomDataEntry({ form, formUrl, row, sequentialId, createdAt: row.createdAt.toISOString(), properties: unwrapped }));
        done(); // signifies that this stream element is fully processed.
      });
    },
    flush(done) { this.push('</atom:feed>'); done(); }
  });

  return inStream.pipe(parserStream);
};


module.exports = { xmlServiceDocumentFor, jsonServiceDocumentFor, edmxFor, rowStreamToAtom };

