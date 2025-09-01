// Copyright 2025 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

class Constants {
  // Not an exhaustive validator.
  // Doesn't guard against all *invalid* values (doesn't track leap years, or which months have which number of days, etc)
  // but should not reject *valid* CE timestamps, yet be better than `.+`.
  // The point is to validate the format of a timestamp and have confidence that PostgreSQL
  // will not interpret it in some unexpected way, and to make sure it has a timestamp offset specified.
  static ISOTimestampTZRegex = new RegExp([
    '^', // let's get it on
    '[0-9]{4}', // year
    '-',
    '((0[1-9])|(1[012]))', // month 01-12
    '-',
    '((0[1-9])|([12][0-9])|(3[01]))', // day 01-31
    'T',
    '(([0-1][0-9])|(2[0-3]))', // hour 01-23
    ':',
    '[0-5][0-9]', // minute 01-59
    ':',
    '(([0-5][0-9])|(60))', // seconds 0-59 or... 60! Trivia question, when does this happen?
    // eslint-disable-next-line no-useless-escape
    '(\.[0-9]+)?', // Optionally, a dot and fractional seconds, down to nanos
    '(Z', // Start of TZ group. Consisting of EITHER a 'Z' for Zulu time (UTC+0)
    '|', // Or...
    '([+-]', // OR instead of 'Z': an offset direction
    '([01][0-9])', // which would be followed by the TZ hour specification (liberal, from -19 to +19 hours, so covers UTC+14, which exists, another trivia question!)
    '(:[0-5][0-9])?', // optionally followed by a TZ minute specification
    ')', // close the hour-minute-offset group
    ')', // close the TZ spec group
    '$', // The End. 😅
  ].join(''));

  // null means "none of the other statuses" (in the UI, sometimes (tautologically) represented with the label "received")
  static submissionReviewStates = new Set(['hasIssues', 'edited', 'approved', 'rejected', null]);

  // null means "none of the other statuses"
  static entityConflictStates = new Set(['soft', 'hard', null]);
}

module.exports = { Constants };
