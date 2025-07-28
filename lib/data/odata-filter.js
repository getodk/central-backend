// Copyright 2020 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const { sql } = require('slonik');
const odataParser = require('odata-v4-parser');
const Problem = require('../util/problem');

const odataParse = expr => {
  try {
    return odataParser.filter(expr);
  } catch (ex) {
    throw Problem.user.unparseableODataExpression({ reason: ex.message });
  }
};

////////////////////////////////////////
// MAIN ENTRY POINT

const odataFilter = (expr, odataToColumnMap) => {
  if (expr == null) return sql`true`;

  ////////////////////////////////////////
  // AST NODE TRANSFORMATION
  // These functions are defined inside odataFilter() so that they can access odataToColumnMap
  // I don't want to pass it to all of them.

  const extractFunctions = ['year', 'month', 'day', 'hour', 'minute', 'second'];
  const methodCall = (node) => {
    // n.b. odata-v4-parser appears to already validate function name and arity.
    const fn = node.value.method;
    const params = node.value.parameters;
    if (extractFunctions.includes(fn)) {
      return sql`extract(${sql.identifier([fn])} from ${op(params[0])})`; // eslint-disable-line no-use-before-define
    } else if (fn === 'now') {
      return sql`now()`;
    } else {
      throw Problem.internal.unsupportedODataExpression({ at: node.position, type: node.type, text: node.raw });
    }
  };
  const booleanOp = sqlQuery => sql`(${sqlQuery})`; // always use parens to ensure the original AST op precedence.

  // We can't pass `${left} IS NOT DISTINCT FROM ${right}` when one of the operand is null because
  // ${null} is transformed into `NULL::<type>` and then postgresql can't use index if available.
  const equality = (node) => {
    const left = op(node.value.left); // eslint-disable-line no-use-before-define
    const right = op(node.value.right); // eslint-disable-line no-use-before-define

    if (left === null && right === null) {
      return booleanOp(sql`TRUE`);
    } else if (left === null) {
      return booleanOp(sql`NULL IS ${right}`);
    } else if (right === null) {
      return booleanOp(sql`${left} IS NULL`);
    } else {
      return booleanOp(sql`${left} IS NOT DISTINCT FROM ${right}`);
    }
  };

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
      return methodCall(node);
    } else if (node.type === 'EqualsExpression') {
      return equality(node);
    } else if (node.type === 'NotEqualsExpression') {
      return booleanOp(sql`NOT ${equality(node)}`);
    } else if (node.type === 'LesserThanExpression') {
      return booleanOp(sql`${op(node.value.left)} < ${op(node.value.right)}`);
    } else if (node.type === 'LesserOrEqualsExpression') {
      return booleanOp(sql`${op(node.value.left)} <= ${op(node.value.right)}`);
    } else if (node.type === 'GreaterThanExpression') {
      return booleanOp(sql`${op(node.value.left)} > ${op(node.value.right)}`);
    } else if (node.type === 'GreaterOrEqualsExpression') {
      return booleanOp(sql`${op(node.value.left)} >= ${op(node.value.right)}`);
    } else if (node.type === 'AndExpression') {
      return booleanOp(sql`${op(node.value.left)} and ${op(node.value.right)}`);
    } else if (node.type === 'OrExpression') {
      return booleanOp(sql`${op(node.value.left)} or ${op(node.value.right)}`);
    } else if (node.type === 'NotExpression') {
      return booleanOp(sql`not ${op(node.value)}`);
    } else if (node.type === 'BoolParenExpression') {
      // Because we add parentheses elsewhere, we don't need to add another set of
      // parentheses here. The main effect of a BoolParenExpression is the way it
      // restructures the AST.
      return op(node.value);
    } else {
      throw Problem.internal.unsupportedODataExpression({ at: node.position, type: node.type, text: node.raw });
    }
  };

  return op(odataParse(expr));
};

// Returns sql expression to exclude deleted records if provided OData filter
// expression doesn't use `__system/deletedAt` field. Logic of this function
// can easily be merged with `OdataFilter()` but it is kept separate for the
// for the sake of simplicity and for separation of concerns.
const odataExcludeDeleted = (expr, odataToColumnMap) => {
  const deleteAtColumn = odataToColumnMap.get('__system/deletedAt')
    ?? odataToColumnMap.get('$root/Submissions/__system/deletedAt');

  const filterOutDeletedRecordsExp = sql`(${sql.identifier(deleteAtColumn.split('.'))} is null)`;

  if (expr == null) return filterOutDeletedRecordsExp;

  const hasDeletedAtClause = (node) => {
    if (node.type === 'FirstMemberExpression' || node.type === 'RootExpression') {
      if (node.raw === '__system/deletedAt'
        || node.raw === '$root/Submissions/__system/deletedAt') return true;
    } else if (node.type === 'MethodCallExpression') {
      // n.b. we only support Unary (single-arity functions)
      return hasDeletedAtClause(node.value.parameters[0]);
    } else if (node.type === 'EqualsExpression'
            || node.type === 'NotEqualsExpression'
            || node.type === 'LesserThanExpression'
            || node.type === 'LesserOrEqualsExpression'
            || node.type === 'GreaterThanExpression'
            || node.type === 'GreaterOrEqualsExpression'
            || node.type === 'AndExpression'
            || node.type === 'OrExpression') {
      return hasDeletedAtClause(node.value.left) || hasDeletedAtClause(node.value.right);
    } else if (node.type === 'BoolParenExpression'
            || node.type === 'NotExpression') {
      return hasDeletedAtClause(node.value);
    }
    return false;
  };

  if (!hasDeletedAtClause(odataParser(expr))) return filterOutDeletedRecordsExp;

  return sql`true`;
};

const odataOrderBy = (expr, odataToColumnMap, stableOrderColumn = null) => {
  let initialOrder = null;
  const clauses = expr.split(',').map((exp) => {
    const [col, order] = exp.trim().split(/\s+/);

    // validate field
    if (!odataToColumnMap.has(col))
      throw Problem.internal.unsupportedODataField({ text: col });

    // validate order (asc or desc)
    if (order && !order?.toLowerCase().match(/^(asc|desc)$/))
      throw Problem.internal.unsupportedODataField({ text: order });

    const sqlOrder = (order?.toLowerCase() === 'desc') ? sql`DESC NULLS LAST` : sql`ASC NULLS FIRST`;

    // Save the order of the initial property to use for the stable sort column order
    if (initialOrder == null)
      initialOrder = sqlOrder;

    return sql`${sql.identifier(odataToColumnMap.get(col).split('.'))} ${sqlOrder}`;
  });

  if (stableOrderColumn != null)
    clauses.push(sql`${sql.identifier(stableOrderColumn.split('.'))} ${initialOrder}`);

  return sql`ORDER BY ${sql.join(clauses, sql`,`)}`;
};

module.exports = { odataFilter, odataOrderBy, odataExcludeDeleted };
