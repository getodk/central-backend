// Copyright 2022 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.
//
// This is an extension of schema.js where we define *entity-specific* functions
// for dealing with the XForms XML schema and transforming submission XML into
// entities.

const csv = require('csv-stringify');
const { clone, path, mergeLeft } = require('ramda');
const { Transform } = require('stream');
const uuid = require('uuid').v4;
const hparser = require('htmlparser2');
const { last } = require('ramda');
const { PartialPipe } = require('../util/stream');
const Problem = require('../util/problem');
const { SchemaStack } = require('./schema');
const { nextUrlFor, getServiceRoot, jsonDataFooter, extractPaging } = require('../util/odata');
const { sanitizeOdataIdentifier, blankStringToNull, isBlank } = require('../util/util');

const odataToColumnMap = new Map([
  ['__id', 'entities.uuid'],
  ['__system/createdAt', 'entities.createdAt'],
  ['__system/updatedAt', 'entities.updatedAt'],
  ['__system/deletedAt', 'entities.deletedAt'],
  ['__system/creatorId', 'entities.creatorId'],
  ['__system/conflict', 'entities.conflict']
]);

// Entity IDs must be UUID v4.  See: https://getodk.github.io/xforms-spec/entities.html#declaring-that-a-form-creates-entities
const _uuidPattern = /^(uuid:)?([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;

////////////////////////////////////////////////////////////////////////////
// ENTITY PARSING

const normalizeUuid = (id) => {
  if (!id || id.trim() === '')
    throw Problem.user.missingParameter({ field: 'uuid' });

  const matches = _uuidPattern.exec(id);
  if (matches == null) throw Problem.user.invalidDataTypeOfParameter({ field: 'uuid', expected: 'valid version 4 UUID' });
  return matches[2].toLowerCase();
};

// Input: object representing entity, parsed from submission XML
const extractLabelFromSubmission = (entity, options = { create: true }) => {
  const { create, update } = options;
  const { label } = entity.system;
  if (update && (!label || label.trim() === ''))
    return null;
  if (create && (!label || label.trim() === ''))
    throw Problem.user.missingParameter({ field: 'label' });
  return label;
};

// Input: object representing entity, parsed from submission XML
const extractBaseVersionFromSubmission = (entity, options = { update: true }) => {
  const { update = false } = options;
  const { baseVersion } = entity.system;
  if (isBlank(baseVersion)) {
    if (update)
      throw Problem.user.missingParameter({ field: 'baseVersion' });
    return null;
  }

  if (!/^\d+$/.test(baseVersion))
    throw Problem.user.invalidDataTypeOfParameter({ field: 'baseVersion', expected: 'integer' });

  return parseInt(entity.system.baseVersion, 10);
};

const extractBranchIdFromSubmission = (entity) => {
  const { branchId } = entity.system;
  if (branchId === '' || branchId == null)
    return null;

  const matches = _uuidPattern.exec(branchId);
  if (matches == null) throw Problem.user.invalidDataTypeOfParameter({ field: 'branchId', expected: 'valid version 4 UUID' });
  return matches[2].toLowerCase();
};

const extractTrunkVersionFromSubmission = (entity) => {
  const { trunkVersion } = entity.system;
  if (trunkVersion) {
    // branchId must be present with trunk version
    const branchId = extractBranchIdFromSubmission(entity);
    if (!branchId)
      throw Problem.user.missingParameter({ field: 'branchId' });

    if (!/^\d+$/.test(trunkVersion))
      throw Problem.user.invalidDataTypeOfParameter({ field: 'trunkVersion', expected: 'integer' });

    return parseInt(entity.system.trunkVersion, 10);
  }
  return null;
};


const submissionXmlToEntityData = (structurals, entityFields, xml) => {
  const stack = new SchemaStack(structurals, true);
  const entityStack = new SchemaStack(entityFields, true);

  const entities = {};

  let textBuffer;
  const parser = new hparser.Parser({
    onopentag: (tagName, attrs) => {
      textBuffer = '';

      // work through the schema
      const structural = stack.push(tagName);
      const entityField = entityStack.push(tagName);

      if ((structural != null) && (structural !== SchemaStack.Wrapper)) {
        if (structural.type === 'structure' || structural.type === 'repeat') {
          if (entityField != null && (entityField !== SchemaStack.Wrapper)) {
            const { name, datasetId } = entityField;
            if (name === 'entity') {
              if (!entities[datasetId]) {
                entities[datasetId] = [{ system: Object.create(null), data: Object.create(null) }];
              }
              const entity = last(entities[datasetId]);
              entity.system.dataset = attrs.dataset;
              entity.system.id = attrs.id;
              entity.system.create = attrs.create;
              entity.system.update = attrs.update;
              entity.system.baseVersion = attrs.baseVersion;
              entity.system.trunkVersion = attrs.trunkVersion;
              entity.system.branchId = attrs.branchId;
            } else {
              if (!entities[datasetId])
                entities[datasetId] = [];

              // Add another entity for this dataset
              entities[datasetId].push({ system: Object.create(null), data: Object.create(null) });
            }
          }
        }
      }
    },
    ontext: (text) => {
      textBuffer += text;
    },
    onclosetag: () => {
      const structural = stack.pop();
      const entityField = entityStack.pop();

      if (structural == null && entityField != null) {

        const { name, propertyName, datasetId } = entityField;

        if (!entities[datasetId]) {
          // It's possible to see entity properties before the entity block
          entities[datasetId] = [{ system: Object.create(null), data: Object.create(null) }];
        }

        const entity = last(entities[datasetId]);

        if (name === 'label')
          entity.system.label = textBuffer;
        else
          entity.data[propertyName] = textBuffer;

      }
    }
  }, { xmlMode: true, decodeEntities: true });

  parser.write(xml);
  parser.end();

  return Object.entries(entities).reduce((acc, ds) => [...acc, ...ds[1]], []);
};

// Can be used to parse new entities and entity updates from
// request data in the form of JSON.
const extractEntity = (body, propertyNames, existingEntity) => {
  const bodyKeys = ['label', 'uuid', 'data'];

  const unexpectedKeys = Object.keys(body).filter(k => !bodyKeys.includes(k));
  if (unexpectedKeys.length > 0)
    throw Problem.user.unexpectedAttributes({ expected: bodyKeys, actual: Object.keys(body) });

  let entity;

  if (existingEntity) {
    entity = clone(existingEntity);
  } else {
    entity = { system: Object.create(null), data: Object.create(null) };
    if (body.uuid && typeof body.uuid !== 'string')
      throw Problem.user.invalidDataTypeOfParameter({ field: 'uuid', expected: 'string' });

    entity.system.uuid = (body.uuid) ? normalizeUuid(body.uuid) : uuid();
  }

  if (body.label != null)
    if (typeof body.label !== 'string')
      throw Problem.user.invalidDataTypeOfParameter({ field: 'label', expected: 'string' });
    else if (body.label.trim() === '')
      throw Problem.user.unexpectedValue({ field: 'label', value: '(empty string)', reason: 'Label cannot be blank.' });
    else
      entity.system.label = body.label;
  else if (!existingEntity)
    throw Problem.user.missingParameter({ field: 'label' });

  if (body.data == null && body.label == null)
    throw Problem.user.invalidEntity({ reason: 'No entity data or label provided.' });

  if (body.data != null)
    for (const [k, v] of Object.entries(body.data)) {
      if (typeof v !== 'string')
        throw Problem.user.invalidDataTypeOfParameter({ field: k, expected: 'string' });
      else if (propertyNames.includes(k))
        entity.data[k] = v;
      else
        throw Problem.user.invalidEntity({ reason: `You specified the dataset property [${k}] which does not exist.` });
    }

  return entity;
};

// Input: object representing source (file name and size), sent via API
// Also handles userAgent string
// Returns validated and sanitized source object
const extractBulkSource = (source, count, userAgent) => {
  if (!source)
    throw Problem.user.missingParameter({ field: 'source' });

  const { name, size } = source;

  if (!name)
    throw Problem.user.missingParameter({ field: 'source.name' });

  if (typeof name !== 'string')
    throw Problem.user.invalidDataTypeOfParameter({ field: 'name', value: typeof name, expected: 'string' });

  if (size != null && typeof size !== 'number')
    throw Problem.user.invalidDataTypeOfParameter({ field: 'size', value: typeof size, expected: 'number' });


  return { name, ...(size) && { size }, count, userAgent: blankStringToNull(userAgent) };
};

////////////////////////////////////////////////////////////////////////////
// ENTITY STREAMING

const _formatRow = (entity, props) => {
  const out = [];
  for (const p of props) out.push(path(p, entity));
  return out;
};


const _entityTransformer = (header, props) => {
  let headerSent = false;
  const entityStream = new Transform({
    objectMode: true,
    transform(entity, _, done) {
      try {
        if (headerSent === false) {
          this.push(header);
          headerSent = true;
        }
        this.push(_formatRow(entity, props));
        done();
      } catch (ex) { done(ex); }
    }, flush(done) {
      if (headerSent === false) this.push(header);
      done();
    }
  });
  return entityStream;
};

const streamEntityCsv = (inStream, properties) => {
  // Identifiers
  const header = [ '__id', 'label' ];
  const props = ['uuid', 'def.label'].map(e => e.split('.'));

  // User defined dataset properties
  header.push(...properties.map(p => p.name));
  props.push(...properties.map(p => ['def', 'data', p.name]));

  // System properties
  header.push(...[ '__createdAt', '__creatorId', '__creatorName', '__updates', '__updatedAt', '__version']);
  props.push(...['createdAt', 'creatorId', 'aux.creator.displayName', 'updates', 'updatedAt', 'def.version'].map(e => e.split('.')));

  const entityStream = _entityTransformer(header, props);

  const csvStringifyer = csv({
    cast: {
      date: (value) => value.toISOString()
    }
  });

  return PartialPipe.of(inStream, entityStream, csvStringifyer);
};

const streamEntityCsvAttachment = (inStream, properties) => {
  // Identifiers
  const header = [ 'name', 'label', '__version' ];
  const props = ['uuid', 'def.label', 'def.version'].map(e => e.split('.'));

  // User defined dataset properties
  header.push(...properties.map(p => p.name));
  props.push(...properties.map(p => ['def', 'data', p.name]));

  const entityStream = _entityTransformer(header, props);

  return PartialPipe.of(inStream, entityStream, csv());
};

const selectFields = (entity, properties, selectedProperties) => {
  const result = {};

  // Handle ID properties
  if (!selectedProperties || selectedProperties.has('__id')) {
    result.__id = entity.uuid;
  }

  if (!selectedProperties || selectedProperties.has('label')) {
    result.label = entity.def.label;
  }

  // Handle System properties
  const systemProperties = {
    createdAt: entity.createdAt,
    creatorId: entity.aux.creator.id.toString(),
    creatorName: entity.aux.creator.displayName,
    updates: entity.updates,
    updatedAt: entity.updatedAt,
    deletedAt: entity.deletedAt,
    version: entity.def.version,
    conflict: entity.conflict
  };

  if (!selectedProperties || selectedProperties.has('__system')) {
    result.__system = systemProperties;
  } else {
    const selectedSysProp = {};
    for (const p of selectedProperties) {
      if (p.startsWith('__system')) {
        const sysProp = p.replace('__system/', '');
        selectedSysProp[sysProp] = systemProperties[sysProp];
      }
    }

    if (Object.keys(selectedSysProp).length > 0) {
      result.__system = selectedSysProp;
    }
  }

  // Handle user defined properties
  properties.forEach(p => {
    if (!selectedProperties || selectedProperties.has(p.name)) {
      result[sanitizeOdataIdentifier(p.name)] = entity.def.data[p.name] ?? '';
    }
  });

  return result;
};

// Validates the '$select'ed properties
// Returns a set of properties or null if $select is null or *
// Note: this function doesn't expand __system properties
const extractSelectedProperties = (query, properties) => {
  if (query.$select && query.$select !== '*') {
    const selectedProperties = query.$select.split(',').map(p => p.trim());
    const propertiesSet = new Set(properties.map(p => p.name));
    selectedProperties.forEach(p => {
      if (p !== '__id' && p !== '__system' && !odataToColumnMap.has(p) && !propertiesSet.has(p)) {
        throw Problem.user.propertyNotFound({ property: p });
      }
    });
    return new Set(selectedProperties);
  }

  return null;
};

// Pagination is done at the database level
const streamEntityOdata = (inStream, properties, domain, originalUrl, query, tableCount, tableRemaining) => {
  const serviceRoot = getServiceRoot(originalUrl);
  const { limit, offset, shouldCount, skipToken } = extractPaging(query);
  const selectedProperties = extractSelectedProperties(query, properties);

  let isFirstEntity = true;
  let lastUuid;
  const rootStream = new Transform({
    writableObjectMode: true, // we take a stream of objects from the db, but
    readableObjectMode: false, // we put out a stream of text.
    transform(entity, _, done) {
      try {
        if (isFirstEntity) { // header or fencepost.
          this.push('{"value":[');
          isFirstEntity = false;
        } else {
          this.push(',');
        }

        lastUuid = entity.uuid;

        this.push(JSON.stringify(selectFields(entity, properties, selectedProperties)));

        done();
      } catch (ex) {
        done(ex);
      }
    }, flush(done) {
      this.push((isFirstEntity) ? '{"value":[],' : '],'); // open object or close row array.

      const remaining = skipToken ? tableRemaining - limit : tableCount - (limit + offset);
      // @odata.count and nextUrl.
      const nextUrl = nextUrlFor(remaining, originalUrl, { uuid: lastUuid });

      this.push(jsonDataFooter({ table: 'Entities', domain, serviceRoot, nextUrl, count: (shouldCount ? tableCount.toString() : null) }));
      done();
    }
  });

  return PartialPipe.of(inStream, rootStream);
};

// Assumption: keys are additive only
// Argument: Array of data object from Entity.Def
const diffEntityData = (defData) => {
  const diffs = [];

  for (let i = 1; i < defData.length; i+=1) {
    const curr = defData[i];
    const prev = defData[i - 1];
    const diff = [];

    for (const key in curr) {
      if (curr[key] !== prev[key]) {
        diff.push({ old: prev[key], new: curr[key], propertyName: key });
      }
    }

    diffs.push(diff);
  }

  return diffs;
};

// Copied from frontend
// Offline branch
class Branch {
  // firstUpdate is the first offline update (not create) to be processed from
  // the branch.
  constructor(firstUpdate) {
    if (firstUpdate.trunkVersion != null) {
      const { trunkVersion } = firstUpdate;
      /* this.lastContiguousWithTrunk is the version number of the last version
      from the branch that is contiguous with the trunk version. In other words,
      it is the version number of the last version where there has been no
      update from outside the branch between the version and the trunk version.
      this.lastContiguousWithTrunk is not related to branch order: as long as
      there hasn't been an update from outside the branch, the branch is
      contiguous, regardless of the order of the updates within it. */
      this.lastContiguousWithTrunk = firstUpdate.version === trunkVersion + 1
        ? firstUpdate.version
        : 0;
    } else {
      /*
      If the entity was both created and updated offline before being sent to
      the server, then there technically isn't a trunk version. On the flip
      side, there also isn't a contiguity problem -- except in one special case.
      If the submission for the entity creation is sent and processed, but the
      submission for the update is not sent at the same time for some reason,
      then it's possible for another update to be made between the two. Once the
      original update is sent and processed, it will no longer be contiguous
      with the entity creation.

      Another special case is if the submission for the entity creation was sent
      late and processed out of order. In that case, firstUpdate.version === 1.
      There's again no contiguity problem (just an order problem), so
      lastContiguousWithTrunk should equal 1.

      The normal case is if firstUpdate.version === 2.
      */
      this.lastContiguousWithTrunk = firstUpdate.version === 2 ? 2 : 1;
    }

    this.id = firstUpdate.branchId;
  }

  add(version) {
    if (version.baseVersion === this.lastContiguousWithTrunk &&
      version.version === version.baseVersion + 1)
      this.lastContiguousWithTrunk = version.version;
  }
}

// Returns an array of properties which are different between
// `dataReceived` and `otherVersionData`
const getDiffProp = (dataReceived, otherVersionData) =>
  Object.keys(dataReceived).filter(key => (!(key in otherVersionData)) || (key in otherVersionData && dataReceived[key] !== otherVersionData[key]));

const ConflictType = {
  SOFT: 'soft', // discrepancy in version number but no overlaping properties
  HARD: 'hard' // discrepancy in version number and one/more properties updated simultaneously
};
const getWithConflictDetails = (defs, audits, relevantToConflict) => {
  const result = [];

  const lastResolveEvent = audits.find(a => a.action === 'entity.update.resolve');

  const auditMap = new Map(audits
    .filter(a => a.action === 'entity.create' || a.action === 'entity.update.version')
    .map(a => [a.details.entityDefId, a.details]));

  let lastGoodVersion = 0; // Entity Version is never 0

  const relevantBaseVersions = new Set();

  const branches = new Map();

  for (const def of defs) {
    // build up branches
    const { branchId } = def;
    if (branchId != null) {
      const existingBranch = branches.get(branchId);
      if (existingBranch == null)
        branches.set(branchId, new Branch(def));
      else
        existingBranch.add(def);
    }

    const v = mergeLeft(def.forApi(),
      {
        conflict: null,
        resolved: false,
        baseDiff: [],
        serverDiff: [],
        lastGoodVersion: false
      });

    // If there is a create or update audit event for this def, attach the source from the audit event
    // because it will be as detailed as possible (full submission, event, etc.)
    // Otherwise use the details found in the source table for this entity def.
    const event = auditMap.get(def.id);
    if (event)
      v.source = event.source;

    if (v.version > 1) { // v.root is false here - can use either
      const baseNotContiguousWithTrunk = v.branchId != null &&
        branches.get(v.branchId).lastContiguousWithTrunk < v.baseVersion;

      // check if it's a create applied as an update, which is also a conflict
      const createAsUpdate = def.aux.source?.details?.action === 'create';

      const conflict = v.version !== (v.baseVersion + 1) ||
        baseNotContiguousWithTrunk || createAsUpdate;

      v.baseDiff = getDiffProp(v.dataReceived, { ...defs[v.baseVersion - 1].data, label: defs[v.baseVersion - 1].label });

      v.serverDiff = getDiffProp(v.dataReceived, { ...defs[v.version - 2].data, label: defs[v.version - 2].label });

      if (conflict) {
        v.conflict = v.conflictingProperties && v.conflictingProperties.length > 0 ? ConflictType.HARD : ConflictType.SOFT;

        v.resolved = !!lastResolveEvent && lastResolveEvent.details.entityDefId >= def.id;

        if (!v.resolved && lastGoodVersion === 0) {
          lastGoodVersion = v.version - 1;
          result[v.version - 2].lastGoodVersion = true;
        }
      }

      // We have some unresolved conflicts
      if (lastGoodVersion > 0) {
        relevantBaseVersions.add(v.baseVersion);
      }
    }

    result.push(v);
  }

  // Set relevantToConflict (Resolution) flag
  // It is relevant if versions comes after last good version or it is the base versions of one of those.
  for (const v of result) {
    v.relevantToConflict = lastGoodVersion > 0 && (v.version >= lastGoodVersion || relevantBaseVersions.has(v.version));
  }

  if (lastGoodVersion === 0) {
    result[result.length - 1].lastGoodVersion = true;
  }

  return relevantToConflict ? result.filter(v => v.relevantToConflict) : result;
};

module.exports = {
  submissionXmlToEntityData,
  extractEntity,
  normalizeUuid,
  extractLabelFromSubmission,
  extractBaseVersionFromSubmission,
  extractTrunkVersionFromSubmission,
  extractBranchIdFromSubmission,
  extractBulkSource,
  streamEntityCsv, streamEntityCsvAttachment,
  streamEntityOdata, odataToColumnMap,
  extractSelectedProperties, selectFields,
  diffEntityData, getWithConflictDetails,
  ConflictType, getDiffProp
};
