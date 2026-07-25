# pmtiles-builder — Scaleway Serverless Job. tippecanoe (apt) + AWS CLI v2 (official installer;
# the ubuntu 24.04 `awscli` apt package was removed). Tools BAKED (Scaleway job has no egress to
# ubuntu archives / aws.amazonaws.com). Build with `docker build --network=host` (buildkit DNS flaky).
FROM ubuntu:24.04
RUN echo 'APT::Sandbox::User "root";' > /etc/apt/apt.conf.d/00no-sandbox \
 && for i in 1 2 3; do apt-get update && apt-get install -y --no-install-recommends tippecanoe ca-certificates findutils curl unzip && break || { echo "apt retry $i"; sleep 8; }; done \
 && curl -fsSL https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip -o /tmp/awscliv2.zip \
 && unzip -q /tmp/awscliv2.zip -d /tmp && /tmp/aws/install \
 && command -v tippecanoe && command -v aws && aws --version \
 && rm -rf /tmp/aws* /tmp/awscliv2.zip /var/lib/apt/lists/*
COPY build-pmtiles-job.sh /usr/local/bin/build-pmtiles-job.sh
RUN chmod +x /usr/local/bin/build-pmtiles-job.sh
ENTRYPOINT ["/usr/local/bin/build-pmtiles-job.sh"]
