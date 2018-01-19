
// takes care of instance envelope boilerplate.
const instance = (formId, instanceId, data) =>
  `<submission><data><data id="${formId}" instanceID="${instanceId}">${data}</data></data></submission>`;

module.exports = {
  instances: {
    withrepeat: {
      one: instance('withrepeat', 'one', '<orx:meta><orx:instanceID>one</orx:instanceID></orx:meta><name>Alice</name><age>30</age>'),
      two: instance('withrepeat', 'two', '<orx:meta><orx:instanceID>two</orx:instanceID></orx:meta><name>Bob</name><age>34</age><children><child><name>Billy</name><age>4</age></child><child><name>Blaine</name><age>6</age></child></children>'),
      three: instance('withrepeat', 'three', '<orx:meta><orx:instanceID>three</orx:instanceID></orx:meta><name>Chelsea</name><age>38</age><children><child><name>Candace</name><age>2</age></child></children>'),
    }
  }
};

