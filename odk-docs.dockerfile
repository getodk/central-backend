FROM sphinxdoc/sphinx

RUN apt-get update && apt-get install -y libenchant-2-2 git

WORKDIR /docs

RUN git clone https://github.com/getodk/docs.git .

RUN sed -i 's/sphinx-autobuild.*/& --host 0.0.0.0/' Makefile

RUN pip3 install -r requirements.txt

ENV  API_SPEC_PATH "/docs/docs/_static/central-spec/api.yaml"

EXPOSE 8000

ENTRYPOINT ["/bin/sh", "-c" , "(pip3 install -r requirements.txt) && (git pull --autostash) && make autobuild"]