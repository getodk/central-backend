# Jubilant Garbanzo
//u r amazing//
![Platform](https://img.shields.io/badge/platform-Node.js-blue.svg)
[![Build status](https://circleci.com/gh/nafundi/jubilant-garbanzo.svg?style=shield)](https://circleci.com/gh/nafundi/jubilant-garbanzo)

Jubilant Garbanzo (or just Jubilant for short) is a minimal [Open Data Kit](https://opendatakit.org/) server based on Node.js and Postgres. It is currently under development. This repository holds back-end code only: [Super Adventure](https://github.com/nafundi/super-adventure) holds front-end code.

## Setting up your development environment

First, install Node.js 8.

Next, create a database and user in Postgres. Either use the same settings as the [default configuration file](config/default.json), or update your local configuration file to match the settings you choose. For example:

```sql
CREATE DATABASE jubilant;
CREATE USER jubilant WITH PASSWORD 'jubilant';
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

## Testing

To run unit tests, open the command line, change the working directory to the root directory of the repository, and type `make test`. We use [Mocha](https://mochajs.org/) and [Should.js](https://shouldjs.github.io/) for unit testing. [CircleCI](https://circleci.com/gh/nafundi/jubilant-garbanzo) is configured to run all unit tests.

To examine test coverage, type `make test-coverage`. We use [Istanbul](https://istanbul.js.org/).

For linting, type `make lint`. We use [ESLint](https://eslint.org/) with [rules](.eslintrc.json) based on the [Airbnb JavaScript style guide](https://github.com/airbnb/javascript).
