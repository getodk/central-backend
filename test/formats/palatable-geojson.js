// Copyright 2025 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

// const fs = require('node:fs');
const { Validator } = require('jsonschema');
const geoJSONSchema = require('./GeoJSON.jsonschema.json'); // from https://geojson.org/schema/GeoJSON.json

// from https://geojson.org/schema/GeoJSON.json
// const geoJSONSchema = JSON.parse(fs.readFileSync('GeoJSON.jsonschema.json'));


function isPalatableGeoJSON(allegedGeoJSON) {
  const validator = new Validator();
  validator.validate(
    allegedGeoJSON,
    geoJSONSchema,
    {
      required: true,
      throwAll: true,
    }
  );
  return true;
}


function palatableGeoJSON(allegedGeoJSON) {
  isPalatableGeoJSON(allegedGeoJSON);
  return allegedGeoJSON;
}


module.exports = { isPalatableGeoJSON, palatableGeoJSON };
