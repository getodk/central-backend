// Copyright 2017 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/opendatakit/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const { curry, compose, identity } = require('ramda');
const Problem = require('./problem');


////////////////////////////////////////////////////////////////////////////////
// PROMISE HELPERS
// prebind these so it doesn't have to be done ad-hoc all the time.

const reject = Promise.reject.bind(Promise);
const resolve = Promise.resolve.bind(Promise);


////////////////////////////////////////////////////////////////////////////////
// .THEN HELPERS
// things that work well with .then; eg: .then(getOrNotFound)

const getOrElse = (orElse) => (option) => option.orElse(orElse);

// can't use option.orElse here, as constructing a reject is necessarily a rejection.
const getOrReject = (rejection) => (option) => (option.isDefined() ? option.get() : reject(rejection));
const getOrNotFound = getOrReject(Problem.user.notFound());

// Given a predicate function (value: Any) => Bool this helper will reject with the
// given Problem if the predicate returns anything but true. Otherwise passes through.
const rejectIf = (predicate, problem) => (value) => ((predicate(value) === true) ? reject(problem(value)) : value);


module.exports = {
  reject, resolve,
  getOrElse, getOrReject, getOrNotFound, rejectIf
};

