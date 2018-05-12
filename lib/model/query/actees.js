// Copyright 2017 Jubilant Garbanzo Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/nafundi/jubilant-garbanzo/blob/master/NOTICE.
// This file is part of Jubilant Garbanzo. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of Jubilant Garbanzo,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const uuid = require('uuid/v4');

module.exports = {
  // given a species, creates a new actee with a uuid and returns it.
  provision: (species) => ({ Actee, actees }) => {
    const id = uuid();
    return actees.create(new Actee({ id, species }));
  },

  create: (actee) => ({ simply }) => simply.create('actees', actee)
};

