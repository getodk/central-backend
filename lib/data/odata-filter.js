// Copyright 2020 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/opendatakit/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const odataParser = require('odata-v4-parser');
const Problem = require('../util/problem');

////////////////////////////////////////
// AST NODE TRANSFORMATION

const extractFunctions = [ 'date', 'time', 'year', 'month', 'day', 'hour', 'minute', 'second' ];
const methodCall = (fn, params, sql, bindings) => {
  // n.b. odata-v4-parser appears to already validate function arity.
  const lowerName = fn.toLowerCase();
  if (extractFunctions.includes(lowerName)) {
    sql.push(`extract(${lowerName} from `);
    op(params[0], sql, bindings); // eslint-disable-line no-use-before-define
    sql.push(')');
  } else if (fn === 'now') {
    sql.push('now()');
  }
};
const binaryOp = (left, right, operator, sql, bindings) => {
  sql.push('('); // always explicitly express the original AST op precedence for safety.
  op(left, sql, bindings); // eslint-disable-line no-use-before-define
  sql.push(` ${operator} `);
  op(right, sql, bindings); // eslint-disable-line no-use-before-define
  sql.push(')');
};
const op = (node, sql, bindings) => {
  if (node.type === 'FirstMemberExpression') {
    if (node.raw === '__system/submissionDate') {
      sql.push('??');
      bindings.push('submissions.createdAt'); // TODO: HACK HACK
    } else if (node.raw === '__system/submitterId') {
      sql.push('??');
      bindings.push('actorId'); // TODO: HACK HACK
    } else {
      throw Problem.internal.unsupportedODataField({ at: node.position, text: node.raw });
    }
  } else if (node.type === 'Literal') {
    sql.push('?');
    bindings.push(node.raw); // OR DO WE WANT TO USE .VALUE HERE?
  } else if (node.type === 'MethodCallExpression') {
    methodCall(node.value.method, node.value.parameters, sql, bindings);
  } else if (node.type === 'EqualsExpression') {
    binaryOp(node.value.left, node.value.right, '=', sql, bindings);
  } else if (node.type === 'NotEqualsExpression') {
    binaryOp(node.value.left, node.value.right, '!=', sql, bindings);
  } else if (node.type === 'LesserThanExpression') {
    binaryOp(node.value.left, node.value.right, '<', sql, bindings);
  } else if (node.type === 'LesserOrEqualsExpression') {
    binaryOp(node.value.left, node.value.right, '<=', sql, bindings);
  } else if (node.type === 'GreaterThanExpression') {
    binaryOp(node.value.left, node.value.right, '>', sql, bindings);
  } else if (node.type === 'GreaterOrEqualsExpression') {
    binaryOp(node.value.left, node.value.right, '>=', sql, bindings);
  } else if (node.type === 'AndExpression') {
    binaryOp(node.value.left, node.value.right, 'and', sql, bindings);
  } else if (node.type === 'OrExpression') {
    binaryOp(node.value.left, node.value.right, 'or', sql, bindings);
  } else {
    throw Problem.internal.unsupportedODataExpression({ at: node.position, type: node.type, text: node.raw });
  }
};

////////////////////////////////////////
// MAIN ENTRY POINT

const applyODataFilter = (expr, db) => {
  let ast; // still hate this.
  try { ast = odataParser.filter(expr); } // eslint-disable-line brace-style
  catch (ex) { throw Problem.user.unparseableODataExpression({ reason: ex.message }); }

  const sql = [];
  const bindings = [];
  op(ast, sql, bindings);
  return db.whereRaw(sql.join(''), bindings);
};

module.exports = { applyODataFilter };

