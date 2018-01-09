# Jubilant Garbanzo

![Platform](https://img.shields.io/badge/platform-Node.js-blue.svg)
[![License](https://img.shields.io/badge/license-Apache_2.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![Build status](https://circleci.com/gh/nafundi/jubilant-garbanzo.svg?style=shield)](https://circleci.com/gh/nafundi/jubilant-garbanzo)

Jubilant Garbanzo (or just Jubilant for short) is a minimal [Open Data Kit](https://opendatakit.org/) server based on Node.js and Postgres. It is currently under development. This repository holds back-end code only: [Super Adventure](https://github.com/nafundi/super-adventure) holds front-end code.

## Setting up your development environment

First, install Node.js 8.

Next, create a database and user in Postgres. Either use the same settings as the [default configuration file](config/default.json), or update your local configuration file to match the settings you choose. For example:

```sql
CREATE USER jubilant WITH PASSWORD 'jubilant';
CREATE DATABASE jubilant with owner=jubilant encoding=UTF8;
```

Next, install Node package dependencies and migrate the database to the latest schema. To do so, open the command line, change the working directory to the root directory of the repository, and type the following:

```bash
npm install
make migrations
```

Or equivalently, simply type `make` with no arguments. (Many `make` rules for the project also run `npm install` and `make migrations`: see the [makefile](Makefile) for details.)

## Running the server

To run the server, open the command line, change the working directory to the root directory of the repository, and type `make run`. Once started, the server will be available on port `8383`.

For other options for running the server, see the [makefile](Makefile).

### Command line scripts

A number of operational tasks (creating accounts, setting passwords, etc) may be accomplished directly via local command line. These may be accessed by running `node lib/cli.js` from the project root (where this README is). Further instructions will be provided by the script.

### Sending email

It isn't necessary to send mail in order to run a development server. For account creation, one may simply use the command line scripts to manually set a password on an account once created. If one wishes to test that emails do work, however, a working localhost SMTP relay must be set up. On a Mac, this may be accomplished as follows:

```bash
sudo postfix tls enable-client
sudo postfix start
```

Even so, often mail messages will go at first to spam, so be sure to check that.

## Testing

Jubilant sports both unit and integration tests. The unit tests (`/test/unit`) check, in isolation, the more-complex parts of Jubilant's core code, such as the query promise and model systems, the various util functions, and some of the http handlers. The integration tests (`/test/api`) focus on verifying the correct behaviour of the API itself and the business logic (ie the `lib/resources/*` code and concrete model/query implementation) which are independently simple but which altogether form a complex system.

To run all tests (both unit and integration), run `make test` in the project root (where this README is). We use [Mocha](https://mochajs.org/) and [Should.js](https://shouldjs.github.io/) as our testing frameworks. [CircleCI](https://circleci.com/gh/nafundi/jubilant-garbanzo) is configured to run all tests for verification.

To run only unit tests, open the command line, run `make test-unit` in the project root.

To run only API integration tests, open the command line, run `make test-api` instead.

To examine test coverage (runs both test suites), type `make test-coverage`. We use [Istanbul](https://istanbul.js.org/).

For linting, type `make lint`. We use [ESLint](https://eslint.org/) with [rules](.eslintrc.json) based on the [Airbnb JavaScript style guide](https://github.com/airbnb/javascript).
