const { validatePropertyName } = require('./dataset');
const Problem = require('../util/problem');

// Validates an actor property name. Actor property names follow the same rules
// as entity dataset property names, with the additional restriction that
// 'displayname' is reserved.
const validateActorPropertyName = (name) =>
  name.toLowerCase() !== 'displayname' && validatePropertyName(name);

// Validates and sanitizes a properties object from an API request body.
// Returns a plain object mapping property names to sanitized values (string or null).
// Empty strings are coerced to null.
const extractActorProperties = (properties) => {
  if (typeof properties !== 'object' || Array.isArray(properties))
    throw Problem.user.unexpectedValue({ field: 'properties', value: properties, reason: 'Must be an object.' });

  const result = Object.create(null);
  for (const [name, value] of Object.entries(properties)) {
    if (value !== null && typeof value !== 'string')
      throw Problem.user.unexpectedValue({ field: name, value, reason: 'Property values must be strings or null.' });
    result[name] = (value == null || value.trim() === '') ? null : value.trim();
  }
  return result;
};

module.exports = { validateActorPropertyName, extractActorProperties };
