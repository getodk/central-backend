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
  // Doesn't guard against all invalid values (doesn't track leap years etc) but should not reject *valid* CE timestamps.
  // The point is to validate the format of a timestamp and have confidence that PostgreSQL will not interpret it in some unexpected way,
  // and to make sure it has a timestamp offset specified.
  static ISOTimestampTZRegex = /^[0-9]{4}-((0[1-9])|(1[012]))-((0[1-9])|([12][0-9])|(3[01]))T(([0-1][0-9])|(2[0-3])):[0-5][0-9]:(([0-5][0-9])|(60))(\.[0-9]+)?(Z|([+-]([01][0-9])(:?[0-5][0-9])?))$/;

  static submissionReviewStates = new Set(['hasIssues', 'edited', 'approved', 'rejected']);
}

module.exports = { Constants };
