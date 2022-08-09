// Copyright 2017 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const appRoot = require('app-root-path');
const { sql } = require('slonik');
const { extender, equals, insert, updater, markDeleted, QueryOptions, unjoiner } = require(appRoot + '/lib/util/db');
const { Dataset } = require(appRoot + '/lib/model/frames/dataset');
const { map, reduce, compose, pickBy, startsWith, nthArg, assoc, keys, curry, nth } = require('ramda');
const { construct } = require(appRoot + '/lib/util/util');

// It removes prefix from all the key of an object
const removePrefix = curry((prefix, obj) => compose(reduce((acc, key) => assoc(key.replace(prefix, ''), obj[key], acc), {}), keys)(obj));

const pickFrameFields = (frame, obj) => compose(
	removePrefix(`${frame.def.from}!`),
	pickBy(compose(startsWith(`${frame.def.from}!`), nthArg(1))))(obj);

const makeHierarchy = reduce((result, item) => {
	const dataset = new Dataset(pickFrameFields(Dataset, item)).forApi();
	const property = new Dataset.Property(pickFrameFields(Dataset.Property, item)).forApi();
	const propertyField = new Dataset.PropertyField(pickFrameFields(Dataset.PropertyField, item)).forApi();

	if (!result[dataset.datasetId]) {
		result[dataset.datasetId] = dataset;
		result[dataset.datasetId].properties = {};
	}

	if (!result[dataset.datasetId].properties[property.dsPropertyId]) {
		result[dataset.datasetId].properties[property.dsPropertyId] = property;
		result[dataset.datasetId].properties[property.dsPropertyId].fields = [];
	}

	result[dataset.datasetId].properties[property.dsPropertyId].fields.push(propertyField);

	return result;
}, {});

const asArray = compose(map(d => ({ ...d, properties: Object.values(d.properties) })), Object.values);

const groupByDataset = compose(Object.values, reduce((result, item) => {
	const { properties, ...dataset } = item.forApi();
	return {
		...result,
		[dataset['datasetId']]: { ...dataset, properties: [...(result[dataset['datasetId']]?.properties || []), properties] }
	};
}, {}));


//////////////////////////////////////////////////////////////////////////////// 
// SQL Queries
const _getAllByProjectId = (projectId) => sql`select ${Dataset.fieldlist} from datasets WHERE "projectId" = ${projectId}`;

const _createOrMerge = (dataset, fields) => {
	return sql`
WITH ds AS (
	INSERT INTO datasets VALUES 
	(uuid_generate_v4(), ${dataset.name}, ${dataset.projectId}, 0) 
	ON CONFLICT ON CONSTRAINT datasets_name_projectid_unique 
	DO UPDATE SET "revisionNumber" = datasets."revisionNumber" + 1  
	RETURNING *
),
fields("propertyName", "formDefId", path) AS (VALUES	  
  ${sql.join(fields.map(p => sql`( ${sql.join([p.aux.propertyName, p.formDefId, p.path], sql`,`)} )`), sql`,`)}
),
dsProperties AS (
	INSERT INTO ds_properties 
	SELECT uuid_generate_v4(), fields."propertyName", ds."datasetId" FROM fields, ds
	ON CONFLICT  ON CONSTRAINT ds_properties_name_datasetid_unique
	DO NOTHING 
	RETURNING ds_properties."dsPropertyId", ds_properties.name, ds_properties."datasetId"
),
dsPropertiesCombined AS (
	(SELECT ds.*, dsProperties."dsPropertyId", dsProperties.name "propertyName", fields."formDefId", fields.path FROM fields
	JOIN dsProperties ON fields."propertyName" = dsProperties.name
	JOIN ds ON ds."datasetId" = dsProperties."datasetId")
	UNION 
	(SELECT ds.*, ds_properties."dsPropertyId", ds_properties.name "propertyName", fields."formDefId", fields.path FROM fields
	JOIN ds_properties ON fields."propertyName" = ds_properties.name
	JOIN ds ON ds."datasetId" = ds_properties."datasetId")
),
dsPropertyFields AS (
	INSERT INTO ds_property_fields
	SELECT "dsPropertyId", "formDefId"::integer, path FROM dsPropertiesCombined
	ON CONFLICT ON CONSTRAINT ds_property_fields_dspropertyid_formdefid_path_unique 
	DO NOTHING
)
SELECT 
	ds."datasetId" as "datasets!datasetId",
	ds."name" as "datasets!name",
	"projectId" as "datasets!projectId",
	"revisionNumber" as "datasets!revisionNumber",
	"dsPropertyId" as "ds_properties!dsPropertyId",
	dsProperties.name as "ds_properties!name"
FROM dsProperties 
JOIN ds ON ds."datasetId" = dsProperties."datasetId"
`};

const _getByIdSql = ((fields, datasetId) => {
	return sql`
	   SELECT
		   ${fields}
	   FROM
		   datasets
	   LEFT OUTER JOIN ds_properties ON
		   datasets."datasetId" = ds_properties."datasetId"
	   LEFT OUTER JOIN ds_property_fields ON
		   ds_properties."dsPropertyId" = ds_property_fields."dsPropertyId"
	   WHERE datasets."datasetId" = ${datasetId}
	`;
});


// Creates or merges dataset, properties and field mapping.
// Expects dataset:Frame and array of field:Frame auxed with property `name`
// Returns dataset:Frame and array of properties:Frame if there are newly created
// so that this can be shown on frontend.
// Few scenarios:
// 1) If dataset, properties and mapping already exists then return nothing.
// 2) If there's difference between existing properties and given fields then only 
//    newly created properties are returned.
// 3) If given field mapping is different then existing mapping then new mapping is 
//    created but nothing is return. 
const createOrMerge = (dataset, fields) => ({ all }) =>
	all(_createOrMerge(dataset, fields))
		.then(all.map(unjoiner(Dataset, Dataset.Property)))
		.then(groupByDataset);

// Returns dataset along with it properties and field mappings		
const getById = (datasetId) => ({ all }) =>
	all(_getByIdSql(unjoiner(Dataset, Dataset.Property, Dataset.PropertyField).fields, datasetId))
		.then(makeHierarchy)
		.then(asArray)
		.then(nth(0));

// Returns list of dataset for a given projectId
// Properties and field mappings are not returned
const getAllByProjectId = (projectId) => ({ all }) => all(_getAllByProjectId(projectId)).then(map(construct(Dataset)));

module.exports = { createOrMerge, getById, getAllByProjectId };