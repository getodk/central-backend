// Copyright 2020 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const { sql } = require('slonik');
const { raw } = require('slonik-sql-tag-raw');
const odataParser = require('odata-v4-parser');
const Problem = require('../util/problem');

////////////////////////////////////////
// MAIN ENTRY POINT

const odataFilter = (expr, odataToColumnMap) => {
  if (expr == null) return sql`true`;

  ////////////////////////////////////////
  // AST NODE TRANSFORMATION
  // These functions are defined inside odataFilter() so that they can access odataToColumnMap
  // I don't want to pass it to all of them.

  const extractFunctions = ['year', 'month', 'day', 'hour', 'minute', 'second'];
  const methodCall = (fn, params) => {
    // n.b. odata-v4-parser appears to already validate function name and arity.
    const lowerName = fn.toLowerCase();
    if (extractFunctions.includes(lowerName))
      return sql`extract(${raw(lowerName)} from ${op(params[0])})`; // eslint-disable-line no-use-before-define
    else if (fn === 'now')
      return sql`now()`;
  };
  const binaryOp = (left, right, operator) =>
    // always use parens to ensure the original AST op precedence.
    sql`(${op(left)} ${raw(operator)} ${op(right)})`; // eslint-disable-line no-use-before-define

  const op = (node) => {
    if (node.type === 'FirstMemberExpression' || node.type === 'RootExpression') {
      if (odataToColumnMap.has(node.raw)) {
        return sql.identifier(odataToColumnMap.get(node.raw).split('.'));
      } else {
        throw Problem.internal.unsupportedODataField({ at: node.position, text: node.raw });
      }
    } else if (node.type === 'Literal') {
      // for some reason string literals come with their quotes
      // TODO: we don't unencode single quotes encoded doubly ('') but we don't support
      // any values w quotes in them yet anyway.
      return (node.raw === 'null') ? null
        : (/^'.*'$/.test(node.raw)) ? node.raw.slice(1, node.raw.length - 1)
          : node.raw; // eslint-disable-line indent
    } else if (node.type === 'MethodCallExpression') {
      return methodCall(node.value.method, node.value.parameters);
    } else if (node.type === 'EqualsExpression') {
      return binaryOp(node.value.left, node.value.right, 'is not distinct from');
    } else if (node.type === 'NotEqualsExpression') {
      return binaryOp(node.value.left, node.value.right, 'is distinct from');
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
    } else if (node.type === 'BoolParenExpression') {
      // Because we add parentheses elsewhere, we don't need to add another set of
      // parentheses here. The main effect of a BoolParenExpression is the way it
      // restructures the AST.
      return op(node.value);
    } else {
      throw Problem.internal.unsupportedODataExpression({ at: node.position, type: node.type, text: node.raw });
    }
  };

  let ast; // still hate this.
  try { ast = odataParser.filter(expr); } // eslint-disable-line brace-style
  catch (ex) { throw Problem.user.unparseableODataExpression({ reason: ex.message }); }

  return op(ast);
};

module.exports = { odataFilter };

