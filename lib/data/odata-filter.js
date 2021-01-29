// Copyright 2020 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/opendatakit/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const { sql } = require('slonik');
const odataParser = require('odata-v4-parser');
const Problem = require('../util/problem');

////////////////////////////////////////
// AST NODE TRANSFORMATION

const extractFunctions = [ 'year', 'month', 'day', 'hour', 'minute', 'second' ];
const methodCall = (fn, params, sql, bindings) => {
  // n.b. odata-v4-parser appears to already validate function name and arity.
  const lowerName = fn.toLowerCase();
  if (extractFunctions.includes(lowerName))
    return sql`extract(${sql.raw(lowerName)} from ${op(params[0])})`;
  else if (fn === 'now')
    return sql`now()`;
  else
    throw Problem.internal.unsupportedODataExpression
};
const binaryOp = (left, right, operator) =>
  // always use parens to ensure the original AST op precedence.
  sql`(${op(left)}${sql.raw(operator)}${op(right)})`;

const op = (node) => {
  if (node.type === 'FirstMemberExpression') {
    if (node.raw === '__system/submissionDate') {
      return sql.identifier([ 'submissions', 'createdAt' ]); // TODO: HACK HACK
    } else if (node.raw === '__system/submitterId') {
      return sql.identifier([ 'submissions', 'submitterId' ]); // TODO: HACK HACK
    } else if (node.raw === '__system/reviewStatus') {
      return sql.identifier([ 'submissions', 'reviewStatus' ]); // TODO: HACK HACK
    } else {
      throw Problem.internal.unsupportedODataField({ at: node.position, text: node.raw });
    }
  } else if (node.type === 'Literal') {
    return node.raw;
  } else if (node.type === 'MethodCallExpression') {
    return methodCall(node.value.method, node.value.parameters);
  } else if (node.type === 'EqualsExpression') {
    return binaryOp(node.value.left, node.value.right, '=');
  } else if (node.type === 'NotEqualsExpression') {
    return binaryOp(node.value.left, node.value.right, '!=');
  } else if (node.type === 'LesserThanExpression') {
    return binaryOp(node.value.left, node.value.right, '<');
  } else if (node.type === 'LesserOrEqualsExpression') {
    return binaryOp(node.value.left, node.value.right, '<=');
  } else if (node.type === 'GreaterThanExpression') {
    return binaryOp(node.value.left, node.value.right, '>');
  } else if (node.type === 'GreaterOrEqualsExpression') {
    return binaryOp(node.value.left, node.value.right, '>=');
  } else if (node.type === 'AndExpression') {
    return binaryOp(node.value.left, node.value.right, 'and');
  } else if (node.type === 'OrExpression') {
    return binaryOp(node.value.left, node.value.right, 'or');
  } else if (node.type === 'NotExpression') {
    return sql`(not ${op(node.value)})`;
  } else {
    throw Problem.internal.unsupportedODataExpression({ at: node.position, type: node.type, text: node.raw });
  }
};

////////////////////////////////////////
// MAIN ENTRY POINT

const odataFilter = (expr) => {
  if (expr == null) return sql`true`;

  let ast; // still hate this.
  try { ast = odataParser.filter(expr); } // eslint-disable-line brace-style
  catch (ex) { throw Problem.user.unparseableODataExpression({ reason: ex.message }); }

  return op(ast);
};

module.exports = { applyODataFilter };

