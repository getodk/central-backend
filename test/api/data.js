
// takes care of instance envelope boilerplate.
const instance = (formId, instanceId, data) =>
  `<data id="${formId}"><orx:meta><orx:instanceID>${instanceId}</orx:instanceID></orx:meta>${data}</data>`;

module.exports = {
  instances: {
    simple: {
      one: instance('simple', 'one', '<name>Alice</name><age>30</age>'),
      two: instance('simple', 'two', '<name>Bob</name><age>34</age>'),
      three: instance('simple', 'three', '<name>Chelsea</name><age>38</age>')
    },
    withrepeat: {
      one: instance('withrepeat', 'one', '<name>Alice</name><age>30</age>'),
      two: instance('withrepeat', 'two', '<name>Bob</name><age>34</age><children><child><name>Billy</name><age>4</age></child><child><name>Blaine</name><age>6</age></child></children>'),
      three: instance('withrepeat', 'three', '<name>Chelsea</name><age>38</age><children><child><name>Candace</name><age>2</age></child></children>'),
    }
  }
};

