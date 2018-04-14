const { max } = Math;
const { Transform } = require('stream');
const path = require('path');
const { parse, render } = require('mustache');
const Problem = require('../util/problem');
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

const extractPaging = (query) => {
  const limit = parseInt(query.$top, 10) || Infinity;
  const offset = parseInt(query.$skip, 10) || 0;
  const shouldCount = isTrue(query.$count);
  return { limit: max(0, limit), offset: max(0, offset), shouldCount };
};
const nextUrlFor = (limit, offset, count, originalUrl) =>
  ((offset + limit >= count)
    ? null
    : urlWithQueryParams(originalUrl, { $skip: (offset + limit), $top: null }));

const extractOptions = (query) => ({ wkt: isTrue(query.$wkt) });

const traverse = (ptr, part) => ((ptr == null) ? null : ptr.children[part]);
const verifyTablePath = (tableParts, schemaLookup) => {
  if (tableParts[0] !== 'Submissions') return false;
  if (tableParts.length === 1) return true;
  const traversed = tableParts.slice(1).reduce(traverse, { children: schemaLookup });
  return (traversed != null) && (traversed.type === 'repeat');
};


////////////////////////////////////////////////////////////////////////////////
// SETUP

// simple helper that precompiles the templates and merges the given data with env.
const template = (body) => {
  parse(body); // caches template for future perf.
  return (data) => render(body, data);
};


////////////////////////////////////////////////////////////////////////////////
// MESSAGES

const serviceDocumentFor = (form, domain, serviceUrl) => ({
  '@odata.context': `${domain}${urlPathname(serviceUrl)}/$metadata`,
  value: [{ name: 'Submissions', kind: 'EntitySet', url: 'Submissions' }]
    .concat(form.tables()
      .map((table) => `Submissions.${table}`)
      .map((table) => ({ name: table, kind: 'EntitySet', url: table })))
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
        <Key><PropertyRef Name="__id"/></Key>
        <Property Name="__id" Type="Edm.String"/>
      {{#properties}}
        {{^navigation}}
        <Property Name="{{name}}" Type="{{type}}"/>
        {{/navigation}}
      {{/properties}}
      </EntityType>
    {{/entityTypes}}
    {{#complexTypes}}
      <ComplexType Name="{{name}}">
      {{#properties}}
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
// the latter two arguments are used internally for recursion; do not provide them.
// of them, fieldPath refers to the path to the present level of recursion, whereas
// tablePath refers to the nearest containing repeat instance path; or in odata
// parlance, the closest entitytype.
const fieldsToEdmx = (fields, fqdnBase, fieldPath = [], tablePath = []) => {
  const properties = [];
  const entityTypes = [];
  const complexTypes = [];

  for (const field of fields) {
    if (Array.isArray(field.children)) {
      const subpath = fieldPath.concat([ field.name ]);
      const subtablePath = (field.type === 'repeat') ? subpath : tablePath;
      const result = fieldsToEdmx(field.children, fqdnBase, subpath, subtablePath);

      entityTypes.push(...result.entityTypes);
      complexTypes.push(...result.complexTypes);

      const fqdnPart = subpath.join('.');
      if (field.type === 'structure') {
        complexTypes.push({ name: fqdnPart, properties: result.properties });
        properties.push({ name: field.name, type: `${fqdnBase}.${fqdnPart}` });
      } else if (field.type === 'repeat') {
        const parentRepeatId = `__Submissions${tablePath.map((part) => `-${part}`).join('')}-id`;
        result.properties.unshift({ name: parentRepeatId, type: 'Edm.String' });
        entityTypes.push({ name: `Submissions.${fqdnPart}`, properties: result.properties });
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
  entityTypes.unshift({ name: 'Submissions', primary: true, properties });
  return edmxTemplater({ form, entityTypes, complexTypes, fqdnBase });
};


////////////////////////////////////////
// JSON DATA FEED

const stripWhitespace = (x) => x.replace(/\n */g, '');
const jsonDataFooter = template(stripWhitespace(`
  "@odata.context":"{{{domain}}}{{{serviceRoot}}}/$metadata#{{table}}"
  {{#nextUrl}},"@odata.nextLink":"{{{domain}}}{{{nextUrl}}}"{{/nextUrl}}
  {{#count}},"@odata.count":{{count}}{{/count}}
}`));

const rowStreamToOData = (form, table, domain, originalUrl, query, inStream) => {
  // cache values we'll need repeatedly.
  const serviceRoot = getServiceRoot(originalUrl, form);
  const schemaLookup = schemaAsLookup(form.schema());
  const { limit, offset, shouldCount } = extractPaging(query);
  const options = extractOptions(query);

  // make sure the target table actually exists. we do this here instead of at the
  // service level so we don't compute the schema twice, and because this ought to
  // be the rare case.
  if (!verifyTablePath(table.split('.'), schemaLookup)) throw Problem.user.notFound();

  // write the header, then transform and stream each row.
  let count = 0;
  const parserStream = new Transform({
    writableObjectMode: true, // we take a stream of objects from the db, but
    readableObjectMode: false, // we put out a stream of text.
    transform(row, _, done) {
      // per row, we do our asynchronous parsing, jam the result onto the
      // text resultstream, and call done to indicate that the row is processed.
      submissionToOData(schemaLookup, table, row, options).then((fields) => {
        for (const field of fields) {
          if ((count >= offset) && (count < (offset + limit))) {
            this.push((count === offset) ? '{"value":[' : ','); // header or fencepost.
            this.push(JSON.stringify(field));
          }
          count += 1;
        }
        done(); // signifies that this stream element is fully processed.
      });
    },
    flush(done) {
      // flush is called just before the transform stream is done and closed; we write
      // our footer information, close the object, and tell the stream we are done.
      const nextUrl = nextUrlFor(limit, offset, count, originalUrl);
      this.push((count <= offset) ? '{' : '],'); // open object or close row array.
      this.push(jsonDataFooter({ form, table, domain, serviceRoot, nextUrl, count: (shouldCount ? count : null) }));
      done();
    }
  });

  return inStream.pipe(parserStream);
};


const singleRowToOData = (form, submission, domain, originalUrl, query) => {
  // basic setup, as above, but also get our requested row context.
  const serviceRoot = getServiceRoot(originalUrl, form);
  const schemaLookup = schemaAsLookup(form.schema());
  const targetContext = extractPathContext(urlPathname(originalUrl).slice(serviceRoot.length)); // only the service subpath
  const options = extractOptions(query);

  // ensure that the target context actually exists.
  const tableParts = targetContext.map((pair) => pair[0]);
  const table = tableParts.join('.');
  if (!verifyTablePath(tableParts, schemaLookup)) throw Problem.user.notFound();

  // extract all our fields first, the field extractor doesn't know about target contexts.
  return submissionToOData(schemaLookup, table, submission, options).then((subrows) => {
    // now we actually filter to the requested set. we actually only need to compare
    // the very last specified id, since it is fully unique.
    const filterContextIdx = targetContext.reduce(((extant, pair, idx) => ((pair[1] != null) ? idx : extant)), -1);
    const filterContextFields = targetContext.slice(0, filterContextIdx + 1).map((pair) => pair[0]);
    const filterField = `__${filterContextFields.join('-')}-id`;
    const filterValue = targetContext[filterContextIdx][1];
    const filtered = (filterContextIdx === 0)
      ? subrows // if the idx is 0, we are already filtered by virtue of being given the submission.
      : subrows.filter((subrow) => subrow[filterField] === filterValue);
    const count = filtered.length;

    // now we can process $top/$skip/$count:
    const { limit, offset, shouldCount } = extractPaging(query);
    const nextUrl = nextUrlFor(limit, offset, count, originalUrl);
    const pared = filtered.slice(offset, offset + limit);

    // and finally splice together and return our result:
    const dataContents = pared.map(JSON.stringify).join(',');
    const footerContents = jsonDataFooter({ form, table, domain, serviceRoot, nextUrl, count: (shouldCount ? count : null) });
    return `{"value":[${dataContents}],${footerContents}`;
  });
};


module.exports = { serviceDocumentFor, edmxFor, rowStreamToOData, singleRowToOData };

