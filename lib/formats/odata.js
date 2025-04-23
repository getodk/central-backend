// Copyright 2017 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.
//
// All final OData output can be found here: functions that generate Service Documents,
// Metadata Documents, and actual data Resource Documents can be found here, along with
// a lot of setup and utility infrastructure to make those things happen.

const { max } = Math;
const { Transform } = require('stream');
const { last } = require('ramda');
const ptr = last; // rename for our context
const { parse, render } = require('mustache');
const Problem = require('../util/problem');
const { isTrue, urlPathname } = require('../util/http');
const { PartialPipe } = require('../util/stream');
const { sanitizeOdataIdentifier, omit } = require('../util/util');
const { jsonDataFooter, extractOptions, nextUrlFor } = require('../util/odata');
const { submissionToOData, systemFields } = require('../data/odata');
const { SchemaStack } = require('../data/schema');
const { QueryOptions } = require('../util/db');


////////////////////////////////////////////////////////////////////////////////
// UTIL

// Given an OData URL subpath and a Form instance, returns that same URL up
// through the .svc base path.
const getServiceRoot = (subpath) => {
  const match = /\.svc\//i.exec(subpath);
  if (match == null) throw Problem.user.notFound(); // something else? shouldn't be possible.
  return subpath.slice(0, match.index + 4); // .svc <- len is 4
};

// Given an OData URL subpath, returns a contextStack: [ [ pathName: String, tableId: String? ] ]
// that the subpath represents.
const extractPathContext = (subpath) =>
  // we have to slice(1) to drop the first element, due to the leading /.
  subpath.split('/').slice(1).map((part) => {
    const match = /^([^(]+)\('((?:uuid:)?[a-z0-9-]+)'\)$/i.exec(decodeURIComponent(part));
    return (match == null) ? [ part, null ] : [ match[1], match[2] ];
  });

// Given a querystring object, processes the paging information off of it. Always
// computes the requested window (limit/offset) so that the correct nextUrl can be
// calculated/ and returned, but also determines whether paging has already been
// performed by the database and therefore what actual slicing to do (doLimit/doOffset).
// { limit: Int, offset: Int, doLimit: Int, doOffset: Int, shouldCount: Bool }.
const extractPaging = (table, query) => {
  const parsedLimit = parseInt(query.$top, 10);
  const limit = Number.isNaN(parsedLimit) ? Infinity : parsedLimit;
  const offset = (!query.$skiptoken && parseInt(query.$skip, 10)) || 0;
  const shouldCount = isTrue(query.$count);
  const skipToken = query.$skiptoken ? QueryOptions.parseSkiptoken(query.$skiptoken) : null;
  const result = { limit: max(0, limit), offset: max(0, offset), shouldCount, skipToken };

  return Object.assign(result, (table === 'Submissions')
    ? { doLimit: Infinity, doOffset: 0 }
    : { doLimit: result.limit, doOffset: result.offset });
};

// Given a tableParts: [ String ] and a schemaLookup: Object given by schemaAsLookup(),
// ensures that the table implied by tableParts actually exists in schemaLookup.
// Traverse is just a private helper function.
const verifyTablePath = (tableParts, fields) => {
  if (tableParts[0] !== 'Submissions') return false;
  if (tableParts.length === 1) return true;

  const stack = new SchemaStack(fields.map(f => ({ ...f, path: f.path.split('/').map(sanitizeOdataIdentifier).join('/') })));
  stack.push();
  for (let idx = 1; idx < tableParts.length; idx += 1)
    if (stack.push(tableParts[idx]) == null)
      return false;

  return stack.head().type === 'repeat';
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

const odataXmlError = template(`<?xml version="1.0" encoding="UTF-8"?>
<error code="{{problemCode}}">
  <message>{{message}}</message>
  <details>{{problemDetails}}</details>
</error>`); // do something xml-ish with problemDetails?

// Directly formulates a data object that conforms to the Service Document format.
const serviceDocumentFor = (fields, domain, serviceUrl) => {
  const tables = [];
  for (const field of fields)
    if (field.type === 'repeat')
      tables.push(field.path.slice(1).split('/').map(sanitizeOdataIdentifier).join('.'));

  return {
    '@odata.context': `${domain}${urlPathname(serviceUrl)}/$metadata`,
    value: [{ name: 'Submissions', kind: 'EntitySet', url: 'Submissions' }]
      .concat(tables
        .map((table) => `Submissions.${table}`)
        .map((table) => ({ name: table, kind: 'EntitySet', url: table })))
  };
};

////////////////////////////////////////
// EDMX metadata document
const fqdnRoot = 'org.opendatakit.user';
const edmxTemplater = template(`<?xml version="1.0" encoding="UTF-8"?>
<edmx:Edmx xmlns:edmx="http://docs.oasis-open.org/odata/ns/edmx" Version="4.0">
  <edmx:DataServices>
    <Schema xmlns="http://docs.oasis-open.org/odata/ns/edm" Namespace="org.opendatakit.submission">
      <ComplexType Name="metadata">
        <Property Name="submissionDate" Type="Edm.DateTimeOffset"/>
        <Property Name="updatedAt" Type="Edm.DateTimeOffset"/>
        <Property Name="deletedAt" Type="Edm.DateTimeOffset"/>
        <Property Name="submitterId" Type="Edm.String"/>
        <Property Name="submitterName" Type="Edm.String"/>
        <Property Name="attachmentsPresent" Type="Edm.Int64"/>
        <Property Name="attachmentsExpected" Type="Edm.Int64"/>
        <Property Name="status" Type="org.opendatakit.submission.Status"/>
        <Property Name="reviewState" Type="org.opendatakit.submission.ReviewState"/>
        <Property Name="deviceId" Type="Edm.String"/>
        <Property Name="edits" Type="Edm.Int64"/>
        <Property Name="formVersion" Type="Edm.String"/>
      </ComplexType>
      <EnumType Name="Status">
        <Member Name="notDecrypted"/>
        <Member Name="missingEncryptedFormData"/>
      </EnumType>
      <EnumType Name="ReviewState">
        <Member Name="hasIssues"/>
        <Member Name="edited"/>
        <Member Name="rejected"/>
        <Member Name="approved"/>
      </EnumType>
    </Schema>
    <Schema xmlns="http://docs.oasis-open.org/odata/ns/edm" Namespace="{{fqdnBase}}">
    {{#entityTypes}}
      <EntityType Name="{{name}}">
        <Key><PropertyRef Name="__id"/></Key>
        <Property Name="__id" Type="Edm.String"/>
      {{#primary}}
        <Property Name="__system" Type="org.opendatakit.submission.metadata"/>
      {{/primary}}
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
      <EntityContainer Name="{{xmlFormId}}">
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

const edmxTemplaterForEntities = template(`<?xml version="1.0" encoding="UTF-8"?>
<edmx:Edmx xmlns:edmx="http://docs.oasis-open.org/odata/ns/edmx" Version="4.0">
  <edmx:DataServices>
    <Schema xmlns="http://docs.oasis-open.org/odata/ns/edm" Namespace="org.opendatakit.entity">
      <ComplexType Name="metadata">
        <Property Name="createdAt" Type="Edm.DateTimeOffset"/>
        <Property Name="creatorId" Type="Edm.String"/>
        <Property Name="creatorName" Type="Edm.String"/>        
        <Property Name="updates" Type="Edm.Int64"/>
        <Property Name="updatedAt" Type="Edm.DateTimeOffset"/>
        <Property Name="deletedAt" Type="Edm.DateTimeOffset"/>
        <Property Name="version" Type="Edm.Int64"/>
        <Property Name="conflict" Type="Edm.String"/>
      </ComplexType>
    </Schema>
    <Schema xmlns="http://docs.oasis-open.org/odata/ns/edm" Namespace="{{fqdnBase}}">    
      <EntityType Name="Entities">
        <Key><PropertyRef Name="__id"/></Key>
        <Property Name="__id" Type="Edm.String"/>
        <Property Name="__system" Type="org.opendatakit.entity.metadata"/>
        <Property Name="label" Type="Edm.String"/>
      {{#properties}}
        <Property Name="{{.}}" Type="Edm.String"/>
      {{/properties}}
      </EntityType>    
      <EntityContainer Name="{{datasetName}}">      
        <EntitySet Name="Entities" EntityType="{{fqdnBase}}.Entities">          
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
                  <PropertyPath>{{.}}</PropertyPath>
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
        </EntitySet>
      </EntityContainer>
    </Schema>
  </edmx:DataServices>
</edmx:Edmx>`);

// helper for edmxFor to convert our types to odata types
const typeMap = {
  int: 'Edm.Int64',
  decimal: 'Edm.Decimal',
  boolean: 'Edm.Boolean',
  geopoint: 'Edm.GeographyPoint',
  geotrace: 'Edm.GeographyLineString',
  geoshape: 'Edm.GeographyPolygon',
  date: 'Edm.Date',
  dateTime: 'Edm.DateTimeOffset'
};

// Relies on the recursive schema transformer fieldsToEdmx() above and the mustache
// template edmxTemplater to return a Metadata Document string given a Form.
const pathToParts = (p) => p.slice(1).split('/').map(sanitizeOdataIdentifier);
const edmxFor = (xmlFormId, fields) => {
  const fqdnBase = `${fqdnRoot}.${sanitizeOdataIdentifier(xmlFormId)}`;

  // iteratively translate a set of fields representing a "table" (root or repeat
  // contents) into an EntityType databag for templating.
  const submissions = { name: 'Submissions', primary: true, properties: [] };
  const entityTypes = [ submissions ];
  const complexTypes = [];
  const stack = [ submissions ];

  // walk through the depth-first field traversal.
  for (const field of fields) {
    let out = ptr(stack);
    while ((out.path != null) && !field.path.startsWith(out.path + '/')) {
      stack.pop();
      out = ptr(stack);
    }

    const name = sanitizeOdataIdentifier(field.name);
    if (field.isStructural()) {
      const typeName = pathToParts(field.path).join('.');
      const type = `${fqdnBase}.Submissions.${typeName}`;

      if (field.type === 'structure') {
        // for a structure, just add the bag and reset our context to it.
        const complex = { name: typeName, type, path: field.path, properties: [] };
        complexTypes.push(complex);
        stack.push(complex);
        out.properties.push({ name, type: `${fqdnBase}.${typeName}` });
      } else if (field.type === 'repeat') {
        // a repeat is more complex; we have to set up a join reference. so first
        // figure out what we are referencing.
        const context = last(stack.filter((o) => o.repeat === true));
        const idNameParts = [ 'Submissions' ];
        if (context != null) idNameParts.push(...pathToParts(context.path));

        // now we can create the bag and push context; but we also inject the parent
        // id reference into that bag.
        const entity = {
          name: `Submissions.${typeName}`, type, path: field.path, repeat: true,
          properties: [{ name: `__${idNameParts.join('-')}-id`, type: 'Edm.String' }]
        };
        entityTypes.push(entity);
        stack.push(entity);
        out.properties.push({ name, type: `Collection(${type})`, navigation: true });
      }
    } else {
      // primitives are easy; just add a property to whatever our context is.
      out.properties.push({ name, type: (typeMap[field.type] || 'Edm.String') });
    }
  }

  return edmxTemplater({ xmlFormId, entityTypes, complexTypes, fqdnBase });
};

const edmxForEntities = (datasetName, properties) => {
  const fqdnBase = `${fqdnRoot}.${sanitizeOdataIdentifier(datasetName)}`;

  return edmxTemplaterForEntities({ datasetName, properties: properties.map(p => sanitizeOdataIdentifier(p.name)), fqdnBase });
};

// Given a Submission rowstream and various other information, returns a
// Stream[String] of the JSON OData resource response for those rows. Parameters:
// form: Form is the Form in question.
// table: String is a dot-delimited subtable path; the stream will return data at that depth.
// domain: String helps formulate the absolute URLs we include with the response.
// originalUrl: String is the request URL; we need it as well to formulate response URLs.
// query: Object is the Express Request query object indicating request querystring parameters.
// inStream: Stream[Row] is the postgres Submissions rowstream.
const rowStreamToOData = (fields, table, domain, originalUrl, query, inStream, tableCount, tableRemaining) => {
  // cache values we'll need repeatedly.
  const serviceRoot = getServiceRoot(originalUrl);
  const { doLimit, doOffset, shouldCount, skipToken } = extractPaging(table, query);
  const options = extractOptions(query);
  const isSubTable = table !== 'Submissions';

  // make sure the target table actually exists.
  // TODO: now that this doesn't require schema computation, should we move it up
  // to the service level, along with the equivalent for singleRowToOData? probably.
  if (!verifyTablePath(table.split('.'), fields)) throw Problem.user.notFound();

  // write the header, then transform and stream each row.
  // To count total number of items for subtable (repeats)
  let counted = 0;
  // To count items added to the downstream, required only for subtable
  let added = 0;
  // To count remaining items in case of subtable
  let remainingItems = 0;

  // skipToken is created based on following two variables
  let lastInstanceId = null;
  let lastRepeatId = null;

  // For Submissions table, it is true because cursor is handled at database level
  let cursorPredicate = !isSubTable || !skipToken;

  const parserStream = new Transform({
    writableObjectMode: true, // we take a stream of objects from the db, but
    readableObjectMode: false, // we put out a stream of text.
    transform(row, _, done) {
      // per row, we do our asynchronous parsing, jam the result onto the
      // text resultstream, and call done to indicate that the row is processed.
      submissionToOData(fields, table, row, options).then(({ data, instanceId }) => {

        const parentIdProperty = data[0] ? Object.keys(data[0]).find(p => /^__.*-id$/.test(p)) : null;

        // In case of subtable we are reading all Submissions without pagination because we have to
        // count repeat items in each Submission
        for (const field of data) {

          // if $select is there and parentId is not requested then remove it
          let fieldRefined = options.metadata && !options.metadata[parentIdProperty] ? omit([parentIdProperty], field) : field;
          // if $select is there and __id is not requested then remove it
          fieldRefined = options.metadata && !options.metadata.__id ? omit(['__id'], fieldRefined) : fieldRefined;

          if (added === doLimit) remainingItems += 1;

          if (added < doLimit && counted >= doOffset && cursorPredicate) {
            this.push((added === 0) ? '{"value":[' : ','); // header or fencepost.
            this.push(JSON.stringify(fieldRefined));
            lastInstanceId = instanceId;
            if (isSubTable) lastRepeatId = field.__id;
            added += 1;
          }

          // Controls the rows to be skipped based on skipToken
          // Once set to true remains true
          cursorPredicate = cursorPredicate || skipToken.repeatId === field.__id;

          counted += 1;
        }
        done(); // signifies that this stream element is fully processed.
      }, done); // raise an error if something goes wrong.
    },
    flush(done) {
      // flush is called just before the transform stream is done and closed; we write
      // our footer information, close the object, and tell the stream we are done.
      if (!cursorPredicate) return this.destroy(Problem.user.odataRepeatIdNotFound());

      this.push((added === 0) ? '{"value":[],' : '],'); // open object or close row array.

      // if we were given an explicit count, use it from here out, to create
      // @odata.count and nextUrl.
      const totalCount = tableCount ?? counted;

      // How many items are remaining for the next page?
      // if there aren't any then we don't need nextUrl
      const remaining = (tableRemaining != null) ? tableRemaining - added : remainingItems;

      let skipTokenData = { instanceId: lastInstanceId };
      if (isSubTable) skipTokenData = { repeatId: lastRepeatId };

      const nextUrl = nextUrlFor(remaining, originalUrl, skipTokenData);

      // we do toString on the totalCount because mustache won't bother rendering
      // the block if it sees integer zero.
      this.push(jsonDataFooter({ table, domain, serviceRoot, nextUrl, count: (shouldCount ? totalCount.toString() : null) }));
      done();
    }
  });

  return PartialPipe.of(inStream, parserStream);
};

const getTableFromOriginalUrl = (originalUrl) => {
  const serviceRoot = getServiceRoot(originalUrl);
  const targetContext = extractPathContext(urlPathname(originalUrl).slice(serviceRoot.length)); // only the service subpath
  const tableParts = targetContext.map((pair) => pair[0]);
  return tableParts.join('.');
};

// Given a single Submission object, returns a Stream[String] of the JSON OData response
// for that single record at the depth specified in the originalUrl. Parameters:
// form: Form is the Form in question.
// submission: Submission is the Submission instance in question.
// domain: String helps formulate the absolute URLs we include with the response.
// originalUrl: String is the request URL; we need it as well to formulate response URLs.
// query: Object is the Express Request query object indicating request querystring parameters.
const singleRowToOData = (fields, row, domain, originalUrl, query) => {
  // basic setup, as above, but also get our requested row context.
  const serviceRoot = getServiceRoot(originalUrl);
  const targetContext = extractPathContext(urlPathname(originalUrl).slice(serviceRoot.length)); // only the service subpath
  const options = extractOptions(query);

  // ensure that the target context actually exists.
  const tableParts = targetContext.map((pair) => pair[0]);
  const table = tableParts.join('.');
  if (!verifyTablePath(tableParts, fields)) throw Problem.user.notFound();

  const isSubTable = table !== 'Submissions';

  // extract all our fields first, the field extractor doesn't know about target contexts.
  return submissionToOData(fields, table, row, options).then(({ data: subrows, instanceId }) => {
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
    const paging = extractPaging(table, query);
    const { limit, shouldCount, skipToken } = paging;
    let { offset } = paging;

    if (skipToken) {
      const { repeatId } = skipToken;
      if (!repeatId) throw Problem.user.odataInvalidSkiptoken();
      offset = filtered.findIndex(s => repeatId === s.__id) + 1;
      if (offset === 0) throw Problem.user.odataRepeatIdNotFound();
    }

    const pared = filtered.slice(offset, offset + limit);

    let nextUrl = null;

    if (pared.length > 0) {
      const remaining = count - (offset + limit);

      let skipTokenData = {
        instanceId
      };

      if (isSubTable) skipTokenData = { repeatId: pared[pared.length - 1].__id };

      nextUrl = nextUrlFor(remaining, originalUrl, skipTokenData);
    }


    // if $select is there and parentId is not requested then remove it
    let paredRefined = options.metadata && !options.metadata[filterField] ? pared.map(p => omit([filterField], p)) : pared;

    // if $select is there and parentId is not requested then remove it
    paredRefined = options.metadata && !options.metadata.__id ? paredRefined.map(p => omit(['__id'], p)) : paredRefined;

    // and finally splice together and return our result:
    const dataContents = JSON.stringify(paredRefined);
    const footerContents = jsonDataFooter({ table, domain, serviceRoot, nextUrl, count: (shouldCount ? count : null) });
    return `{"value":${dataContents},${footerContents}`;
  });
};

// Create a tree of form fields
// Where each node has reference to its parent and children
// Returns an object with key=path and value=fieldNode
// so that we can quickly get the field node instead of traversing tree from top to bottom
// Assumption: formFields are in order
const getFieldTree = (formFields) => {
  const tree = {};

  for (let i = 0; i < formFields.length; i += 1) {
    const node = { value: formFields[i], children: [], parent: null };
    tree[`${node.value.path.split('/').map(sanitizeOdataIdentifier).join('/')}`] = node;
  }

  for (const i of Object.keys(tree)) {
    const node = tree[i];
    const parentPath = node.value.path.match(/(^.*)\//)[1].split('/').map(sanitizeOdataIdentifier).join('/');

    if (tree[parentPath]) {
      node.parent = tree[parentPath];
      node.parent.children.push(node);
    }
  }

  return tree;
};

// Returns children recursively
const getChildren = (field) => {
  const result = new Set();
  const stack = [];
  stack.push(field);

  while (stack.length > 0) {
    const node = stack.pop();
    node.children.forEach(c => {
      if (c.value.type === 'structure') {
        stack.push(c);
      }
      result.add(c.value);
    });
  }
  return result;
};

// Validates $select query parameter including metadata properties and returns list of FormFields
const filterFields = (formFields, select, table) => {
  const filteredFields = new Set();
  const fieldTree = getFieldTree(formFields);

  let path = '';

  const idKeys = new Set(['__id']);

  // we return parent ID with the subtable, but the key is dynamic
  // based on the last repeat field
  let parentIdKey = '__Submissions';

  // For subtables we have to include parents fields
  if (table !== 'Submissions') {
    const tableSegments = table.replace(/Submissions\./, '').split('.');
    for (let i = 0; i < tableSegments.length; i+=1) {
      const tableSegment = tableSegments[i];

      path += `/${tableSegment}`;
      if (!fieldTree[path]) throw Problem.user.notFound();
      filteredFields.add(fieldTree[path].value);

      if (fieldTree[path].value.type === 'repeat' && i < tableSegments.length-1) {
        parentIdKey = `__Submissions${path.replaceAll('/', '-')}`;
      }
    }
    parentIdKey += '-id';
    idKeys.add(parentIdKey);
  }

  for (const property of select.split(',').map(p => p.trim())) {
    // validate metadata properties. __system/.. properties are only valid for Submission table
    if (idKeys.has(property) || (table === 'Submissions' && systemFields.has(property))) {
      continue;
    }

    const field = fieldTree[`${path}/${property}`];
    if (!field) throw Problem.user.propertyNotFound({ property });

    filteredFields.add(field.value);

    // we have to include parents fields in the result to handle grouped fields
    let node = field.parent;
    while (node && !filteredFields.has(node.value)) { // filteredFields set already has the subtables
      // Child field of a repeat field is not supported
      if (node.value.type === 'repeat') throw Problem.user.unsupportedODataSelectField({ property });

      filteredFields.add(node.value);
      node = node.parent;
    }

    // Include the children of structure/group
    // Note: This doesn't expand 'repeat' fields
    if (field.value.type === 'structure') {
      getChildren(field).forEach(filteredFields.add, filteredFields);
    }
  }

  const filteredFieldsArr = Array.from(filteredFields);
  // Sort the fields by `order` as Set() doesn't gurantee an order
  filteredFieldsArr.sort((a, b) => a.order - b.order);
  // Resequence the order because downstream function(s) are dependent on it e.g schema.children
  for (let i = 0; i < filteredFieldsArr.length; i += 1) {
    filteredFieldsArr[i] = filteredFieldsArr[i].with({ order: i });
  }

  return filteredFieldsArr;
};

const selectFields = (query, table) => (fields) => (query.$select && query.$select !== '*' ? filterFields(fields, query.$select, table) : fields);

module.exports = {
  odataXmlError, serviceDocumentFor, edmxFor,
  rowStreamToOData, singleRowToOData,
  selectFields, getTableFromOriginalUrl,
  edmxForEntities,
  // exporting for unit tests
  getFieldTree, getChildren
};

