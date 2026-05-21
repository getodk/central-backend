const { validatePropertyName } = require('./dataset');
const Problem = require('../util/problem');

// Validates an actor property name. Actor property names follow the same rules
// as entity dataset property names, with the additional restriction that
// 'displayname' is reserved.
const validateActorPropertyName = (name) =>
  name.toLowerCase() !== 'displayname' && validatePropertyName(name);

// Validates and sanitizes a properties object from an API request body.
// knownNames is an array of property name strings defined for this project.
// Returns a plain object mapping property names to sanitized values (string or null).
// Empty strings are coerced to null. Throws a 400 if any property name is unknown.
const extractActorProperties = (properties, knownNames) => {
  if (typeof properties !== 'object' || Array.isArray(properties))
    throw Problem.user.unexpectedValue({ field: 'properties', value: properties, reason: 'Must be an object.' });

  const knownSet = new Set(knownNames);
  const result = Object.create(null);
  for (const [name, value] of Object.entries(properties)) {
    if (!knownSet.has(name))
      throw Problem.user.unexpectedValue({ field: 'properties', value: name, reason: 'Unknown property name.' });
    if (value !== null && typeof value !== 'string')
      throw Problem.user.unexpectedValue({ field: name, value, reason: 'Property values must be strings or null.' });
    result[name] = (value == null || value.trim() === '') ? null : value.trim();
  }
  return result;
};

module.exports = { validateActorPropertyName, extractActorProperties };
