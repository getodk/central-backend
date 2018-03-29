const { Readable, Transform } = require('stream');
const config = require('config');
const path = require('path');
const { merge } = require('ramda');
const { parse, render } = require('mustache');
const { isBlank } = require('../util/util');
const { urlPathname, urlWithQueryParams } = require('../util/http');
const { schemaAsLookup } = require('../data/schema');
const { extractFields } = require('../data/json');

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

const serviceDocumentFor = (form, formUrl) => ({
  '@odata.context': `${env.domain}${urlPathname(formUrl)}/$metadata`,
  value: [{ name: 'Submissions', kind: 'EntitySet', url: 'Submissions' }]
    .concat(form.tables().map((table) => `Submissions.${table}`).map((table) =>
      ({ name: table, kind: 'EntitySet', url: table })))
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
        <EntitySet Name="{{name}}" EntityType="{{fqdnBase}}.{{name}}">
          {{#primary}}
          <Annotation Term="Org.OData.Capabilities.V1.ConformanceLevel" EnumMember="Org.OData.Capabilities.V1.ConformanceLevelType/Minimal"/>
          <Annotation Term="Org.OData.Capabilities.V1.BatchSupported" Bool="false"/>
          <Annotation Term="Org.OData.Capabilities.V1.CountRestrictions">
            <Record><PropertyValue Property="Countable" Bool="true"/></Record>
          </Annotation>
          <Annotation Term="Org.OData.Capabilities.V1.FilterFunctions">
            <Record>
              <PropertyValue Property="NonCountableProperties">
                <Collection>
                  <String>eq</String>
                </Collection>
              </PropertyValue>
            </Record>
          </Annotation>
          <Annotation Term="Org.OData.Capabilities.V1.FilterFunctions">
            <Record>
              <PropertyValue Property="Filterable" Bool="true"/>
              <PropertyValue Property="RequiresFilter" Bool="false"/>
              <PropertyValue Property="NonFilterableProperties">
                <Collection>
                {{#properties}}
                  <PropertyPath>{{name}}</PropertyPath>
                {{/properties}}
                </Collection>
              </PropertyValue>
            </Record>
          </Annotation>
          <Annotation Term="Org.OData.Capabilities.V1.SortRestrictions">
            <Record><PropertyValue Property="Sortable" Bool="false"/></Record>
          </Annotation>
          <Annotation Term="Org.OData.Capabilities.V1.ExpandRestrictions">
            <Record><PropertyValue Property="Expandable" Bool="false"/></Record>
          </Annotation>
          {{/primary}}
        </EntitySet>
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
const fieldsToEdmx = (fields, fqdnBase, path = [], parentRepeatPath = []) => {
  const properties = [];
  const entityTypes = [];
  const complexTypes = [];

  for (const field of fields) {
    if (Array.isArray(field.children)) {
      const subpath = path.concat([ field.name ]);
      const prSubpath = (field.type === 'repeat') ? subpath : parentRepeatPath;
      const result = fieldsToEdmx(field.children, fqdnBase, subpath, prSubpath);

      entityTypes.push(...result.entityTypes);
      complexTypes.push(...result.complexTypes);

      const fqdnPart = subpath.join('.');
      if (field.type === 'structure') {
        complexTypes.push({ name: fqdnPart, properties: result.properties });
        properties.push({ name: field.name, type: `${fqdnBase}.${fqdnPart}` });
      } else if (field.type === 'repeat') {
        const parentRepeatId = `__Submissions${parentRepeatPath.map((part) => `-${part}`).join('')}-id`;
        result.properties.unshift({ name: parentRepeatId, type: 'Edm.String' });
        entityTypes.push({ name: `Submissions.${fqdnPart}`, key: '__id', properties: result.properties });
        properties.push({ name: field.name, type: `Collection(${fqdnBase}.Submissions.${fqdnPart})` });
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
  entityTypes.unshift({ name: 'Submissions', key: '__id', primary: true, properties });
  return edmxTemplater({ form, entityTypes, complexTypes, fqdnBase });
};


////////////////////////////////////////
// JSON DATA FEED

const stripWhitespace = (x) => x.replace(/\n */g, '');
const jsonDataPreamble = template(stripWhitespace(`{
  "@odata.context":"{{{domain}}}{{{formUrl}}}/$metadata#{{table}}",
  {{#nextUrl}}"@odata.nextLink":"{{{domain}}}{{{nextUrl}}}",{{/nextUrl}}
  {{#count}}"@odata.count":{{count}},{{/count}}
  "value":[`));

const rowStreamToOData = (form, table, query, tableUrl, inStream, count) => {
  // cache values we'll need repeatedly.
  const formUrl = path.resolve(urlPathname(tableUrl), '..');
  const schemaLookup = schemaAsLookup(form.schema());

  // set up a bunch of values for odata metadata annotations.
  const limit = parseInt(query['$top']);
  const offset = parseInt(query['$skip']) || 0;
  const nextUrl = (Number.isNaN(limit) || (offset + limit >= count))
    ? null
    : urlWithQueryParams(tableUrl, { '$skip': (offset + limit), '$top': null });

  const shouldCount = !isBlank(query['$count']) && (query['$count'].toLowerCase() === 'true');

  // write the header, then transform and stream each row.
  let wroteHeader = false;
  let isFirstRecord = true;
  const parserStream = new Transform({
    writableObjectMode: true,
    readableObjectMode: false,
    transform(row, _, done) {
      // first see if we have to write a header out (TODO: is there a cleverer way?)
      if (wroteHeader === false) {
        this.push(jsonDataPreamble({ form, table, formUrl, nextUrl, count: (shouldCount ? count : null) }));
        wroteHeader = true;
      }

      // do transformation on the xml to strip the outer layers.
      extractFields(schemaLookup, table, row).then((fields) => {
        for (field of fields) {
          // fenceposting.
          if (isFirstRecord === false) this.push(',');
          isFirstRecord = false;

          this.push(JSON.stringify(field));
        }
        done(); // signifies that this stream element is fully processed.
      });
    },
    flush(done) { this.push(']}'); done(); }
  });

  return inStream.pipe(parserStream);
};


module.exports = { serviceDocumentFor, edmxFor, rowStreamToOData };

