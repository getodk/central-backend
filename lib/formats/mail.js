// Copyright 2017 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.
//
// Here you will find two things: the full set of email message templates, as well
// as infrastructure for sending email.

const { parse, render } = require('mustache');
const { mergeRight } = require('ramda');

// set up each message.
const message = (subject, body) => {
  parse(subject); // caches template for future perf.
  parse(body); // ditto.
  return (data, env) => {
    const localData = mergeRight(data, env);
    return { subject: render(subject, localData), html: render(body, localData) };
  };
};

const messages = {
  // Notifies a user that an account has been provisioned at this address; gives
  // them the link required to set their password.
  // * {{token}} is the auth token that grants access to this operation.
  accountCreated: message('ODK Central account created', '<html>Hello!<p>An account has been provisioned for you on an ODK Central data collection server.</p><p>If this message is unexpected, simply ignore it. Otherwise, please visit the following link to set your password and claim your account:</p><p><a href="{{{domain}}}/#/account/claim?token={{token}}">{{{domain}}}/#/account/claim?token={{token}}</a></p><p>The link is valid for 24 hours. After that, you will have to request a new one by resetting your password:</p><p><a href="{{{domain}}}/#/reset-password">{{{domain}}}/#/reset-password</a></p></html>'),

  // Notifies a user that an account has been created with a predetermined password.
  accountCreatedWithPassword: message('ODK Central account created', '<html>Hello!<p>An account has been provisioned for you on an ODK Central data collection server.</p><p>If this message is unexpected, simply ignore it. Your account was created with an assigned password. Please use that password to <a href="{{{domain}}}">sign in</a>.</p><p>If you have not been given the password, or you cannot remember it, you can reset it at any time at this link:</p><p><a href="{{{domain}}}/#/reset-password">{{{domain}}}/#/reset-password</a></p></html>'),

  // Notifies a user that their account's email has been changed
  accountEmailChanged: message('ODK Central account email changed', '<html>Hello!<p><p>We are emailing because you have an ODK Central data collection account, and somebody has just changed the email address associated with the account from this one you are reading right now ({{oldEmail}}) to a new address ({{newEmail}}).</p><p>If this was you, please feel free to ignore this email. Otherwise, please contact your local ODK system administrator immediately.</p></html>'),

  // Notifies a user that a password reset has been initiated for their email;
  // gives them the link required to set their password.
  // * {{token}} is the auth token that grants access to this operation.
  accountReset: message('ODK Central account password reset', '<html>Hello!<p>A password reset has been requested for this email address.</p><p>If this message is unexpected, simply ignore it. Otherwise, please visit the following link to set your password and claim your account:</p><p><a href="{{{domain}}}/#/account/claim?token={{token}}">{{{domain}}}/#/account/claim?token={{token}}</a></p><p>The link is valid for 24 hours. After that, you will have to request a new one by resetting your password:</p><p><a href="{{{domain}}}/#/reset-password">{{{domain}}}/#/reset-password</a></p></html>'),

  // Notifies an email address that a password reset has been initiated, but that
  // the account that we know about has been deleted.
  accountResetDeleted: message('ODK Central account password reset', '<html>Hello!<p>A password reset has been requested for this email address, but the account has been deleted.</p><p>If this message is unexpected, simply ignore it. Otherwise, please double check the email address given for your account, and try contacting your ODK system administrator.</p></html>'),

  // Notifies a user that their password has been changed
  accountPasswordChanged: message('ODK Central account password change', '<html>Hello!<p>We are emailing because you have an ODK Central data collection account, and somebody has just changed its password.</p><p>If this was you, please feel free to ignore this email.</p><p>Otherwise, please contact your local ODK system administrator immediately.</p></html>'),

  backupFailed: message('ODK Central backup failed', '<html>Hello:<p>This is an automated system message to the listed ODK Central system administrator. ODK Central just attempted to perform a backup, but was unable to. Please visit <a href="{{{domain}}}/#/system/backups">the Backups settings page</a> on the administration website for more information.</p></html>')
};

module.exports = { messages };

