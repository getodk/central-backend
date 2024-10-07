// Copyright 2024 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.
//
// We wrap almost all our Express resource declarations in one of the endpoint
// functions found below. These functions help deal with the possible return
// values from the business logic, performing useful tasks like resolving
// `Promise`s, managing output `Stream`s, and handling errors.
//
// There are specialized versions of endpoint for OpenRosa and OData-related
// actions.

// Standard simple serializer for object output.
// Behaves a little differently at the root call vs nested; because we want eg
// Array[User] to automatically serialize each User, we want to delve into the
// list and rerun the serializer for each entry given an Array. But we don't want
// to individually serialize plain objects to text or we end up with an array
// of JSON strings.
const serialize = (obj) => {
  if (obj === undefined)
    return null;
  else if (typeof obj?.forApi === 'function')
    return obj.forApi();
  else if (Array.isArray(obj))
    return obj.map(serialize);
  else
    return obj;
};

module.exports = (obj) => JSON.stringify(serialize(obj));
