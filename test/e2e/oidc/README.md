oidc-dev
========

Tools to help dev & testing of OpenID Connect / OAuth2 (OIDC) as identity provider for ODK Central.

Testing OIDC is tricky because there are a number of requirements and moving parts.

To properly test HTTP flows between servers and proper cookie handling, we need OIDC & ODK Central servers both:

1. exposed on separate hosts/domains
2. serving over HTTPS
