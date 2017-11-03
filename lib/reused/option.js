class Option {
  static of(value) {
    return value instanceof Option
      ? value
      : value === null || value === undefined
        ? none
        : new Some(value);
  }

  static none() {
    return none;
  }
}

class Some extends Option {
  /* istanbul ignore next */
  constructor(value) {
    super();
    this.value = value;
  }

  get() {
    return this.value;
  }

  map(fn) {
    return Option.of(fn(this.value));
  }

  filter(predicate) {
    return predicate(this.value) ? this : none;
  }

  orNull() {
    return this.value;
  }

  orElse(defaultValue) {
    return this.value;
  }

  orElseGet(defaultValueProvider) {
    return this.value;
  }

  orThrow(msg) {
    return this.value;
  }

  isDefined() {
    return true;
  }

  isEmpty() {
    return false;
  }

  ifDefined(consumer) {
    consumer(this.value);
  }
}

class None extends Option {
  /* istanbul ignore next */
  constructor() {
    super();
  }

  get() {
    throw new Error("Value not present");
  }

  map(fn) {
    return this;
  }

  filter(predicate) {
    return this;
  }

  orNull() {
    return null;
  }

  orElse(defaultValue) {
    return defaultValue;
  }

  orElseGet(defaultValueProvider) {
    return defaultValueProvider();
  }

  orThrow(msg) {
    throw new Error(msg);
  }

  isDefined() {
    return false;
  }

  isEmpty() {
    return true;
  }

  ifDefined(consumer) {

  }
}

const none = new None();

module.exports = Option;