const { Readable, Transform } = require('stream');
const config = require('config');
const path = require('path');
const { merge } = require('ramda');
const { parse, render } = require('mustache');
const Problem = require('../util/problem');
const { isBlank } = require('../util/util');
const { isTrue, urlPathname, urlWithQueryParams } = require('../util/http');
const { schemaAsLookup } = require('../data/schema');
const { submissionToOData } = require('../data/json');


////////////////////////////////////////////////////////////////////////////////
// UTIL

const getServiceRoot = (subpath, form) => {
  const target = `${form.xmlFormId}.svc`;
  let result = urlPathname(subpath);
  while (path.basename(result) !== target)
    result = path.resolve(result, '..');
  return result;
};

const extractPathContext = (subpath) =>
  // slash is not a valid identifier character, so we can split on / blithely.
  // we also have to slice(1) to drop the first element, due to the leading /.
  subpath.split('/').slice(1).map((part) => {
    const match = /^([^(]+)\('((?:uuid:)?[a-z0-9-]+)'\)$/i.exec(part);
    return (match == null) ? [ part, null ] : [ match[1], match[2] ];
  });

const extractPaging = (query, count, originalUrl) => {
  const limit = parseInt(query['$top']);
  const offset = parseInt(query['$skip']) || 0;
  const nextUrl = (Number.isNaN(limit) || (offset + limit >= count))
    ? null
    : urlWithQueryParams(originalUrl, { '$skip': (offset + limit), '$top': null });
  const shouldCount = isTrue(query['$count']);
  return { limit, offset, nextUrl, shouldCount };
};

const extractOptions = (query) => ({
  wkt: isTrue(query['$wkt'])
});

const traverse = (ptr, part) => ((ptr == null) ? null : ptr.children[part]);
const verifyTablePath = (path, schemaLookup) => {
  if (path[0] !== 'Submissions') return false;
  const traversed = path.slice(1).reduce(traverse, { children: schemaLookup });
  return (traversed != null) && (traversed.type === 'repeat');
};


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
        {{#navigation}}
        <NavigationProperty Name="{{name}}" Type="{{type}}"/>
        {{/navigation}}
        {{^navigation}}
        <Property Name="{{name}}" Type="{{type}}"/>
        {{/navigation}}
      {{/properties}}
      </EntityType>
    {{/entityTypes}}
    {{#complexTypes}}
      <ComplexType Name="{{name}}">
      {{#properties}}
        {{#navigation}}
        <NavigationProperty Name="{{name}}" Type="{{type}}"/>
        {{/navigation}}
        {{^navigation}}
        <Property Name="{{name}}" Type="{{type}}"/>
        {{/navigation}}
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
        properties.push({ name: field.name, type: `Collection(${fqdnBase}.Submissions.${fqdnPart})`, navigation: true });
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
  "@odata.context":"{{{domain}}}{{{serviceRoot}}}/$metadata#{{table}}",
  {{#nextUrl}}"@odata.nextLink":"{{{domain}}}{{{nextUrl}}}",{{/nextUrl}}
  {{#count}}"@odata.count":{{count}},{{/count}}
  "value":[`));

const rowStreamToOData = (form, table, query, originalUrl, inStream, count) => {
  // cache values we'll need repeatedly.
  const serviceRoot = getServiceRoot(originalUrl, form);
  const schemaLookup = schemaAsLookup(form.schema());
  const { limit, offset, nextUrl, shouldCount } = extractPaging(query, count, originalUrl);
  const options = extractOptions(query);

  // make sure the target table actually exists. we do this here instead of at the
  // service level so we don't compute the schema twice, and because this ought to
  // be the rare case.
  if (!verifyTablePath(table.split('.'), schemaLookup)) throw Problem.user.notFound();

  // write the header, then transform and stream each row.
  let wroteHeader = false;
  let isFirstRecord = true;
  const parserStream = new Transform({
    writableObjectMode: true,
    readableObjectMode: false,
    transform(row, _, done) {
      // first see if we have to write a header out (TODO: is there a cleverer way?)
      if (wroteHeader === false) {
        this.push(jsonDataPreamble({ form, table, serviceRoot, nextUrl, count: (shouldCount ? count : null) }));
        wroteHeader = true;
      }

      // do transformation on the xml to strip the outer layers.
      submissionToOData(schemaLookup, table, row, options).then((fields) => {
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


const singleRowToOData = (form, submission, query, originalUrl) => {
  // basic setup, as above, but also get our requested row context.
  const serviceRoot = getServiceRoot(originalUrl, form);
  const schemaLookup = schemaAsLookup(form.schema());
  const targetContext = extractPathContext(urlPathname(originalUrl).slice(serviceRoot.length)); // only the service subpath
  const options = extractOptions(query);

  // ensure that the target context actually exists.
  if (!verifyTablePath(targetContext.map((pair) => pair[0]), schemaLookup)) throw Problem.user.notFound();

  // extract all our fields first, the field extractor doesn't know about target contexts.
  const table = targetContext.map((pair) => pair[0]).join('.');
  return submissionToOData(schemaLookup, table, submission, options).then((subrows) => {
    // now we actually filter to the requested set. we actually only need to compare
    // the very last specified id, since it is fully unique.
    const filterContextIdx = targetContext.reduce(((extant, pair, idx) => ((pair[1] != null) ? idx : extant)), -1);
    const filterContextFields = targetContext.slice(0, filterContextIdx + 1).map((pair) => pair[0]);
    const filterField = `__${filterContextFields.join('-')}-id`;
    const filterValue = targetContext[filterContextIdx][1];
    const filtered = subrows.filter((subrow) => subrow[filterField] === filterValue);
    const count = filtered.length;

    // now we can process $top/$skip/$count:
    const { limit, offset, nextUrl, shouldCount } = extractPaging(query, count, originalUrl);
    const pared = Number.isNaN(limit) ? filtered.slice(offset) : filtered.slice(offset, offset + limit);

    // and finally splice together and return our result:
    return jsonDataPreamble({ form, table, serviceRoot, nextUrl, count: (shouldCount ? count : null) }) +
      pared.map(JSON.stringify).join(',') + ']}';
  });
};


module.exports = { serviceDocumentFor, edmxFor, rowStreamToOData, singleRowToOData };

