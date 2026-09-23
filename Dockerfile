ARG NODE_IMAGE=node:24-trixie-slim
FROM ${NODE_IMAGE} AS release-validation

COPY deploy/stage/ /stage/
COPY deploy/validate-release.mjs /validate-release.mjs
RUN node /validate-release.mjs /stage

FROM ${NODE_IMAGE}

ARG SOURCE_REVISION
LABEL org.opencontainers.image.source="https://github.com/cmtymeet/cmeet" \
      org.opencontainers.image.revision="${SOURCE_REVISION}"
ENV NODE_ENV=production
WORKDIR /app

# deploy/stage is assembled and validated outside this image from retained CI
# artifacts. This image deliberately performs no source build, dependency
# resolution, network download, or toolchain installation.
COPY --from=release-validation /stage/package.json ./package.json
COPY --from=release-validation /stage/package-lock.json ./package-lock.json
COPY --from=release-validation /stage/node_modules/ ./node_modules/
COPY --from=release-validation /stage/vendor/ ./vendor/
COPY --from=release-validation /stage/server/ ./server/
COPY --from=release-validation /stage/dist/ ./dist/
COPY --from=release-validation /stage/bin/cmeet-cfrm-backend ./bin/cmeet-cfrm-backend
COPY --from=release-validation /stage/bin/cvld-voucher-bridge ./bin/cvld-voucher-bridge
COPY --from=release-validation /stage/release-manifest.json ./release-manifest.json
COPY deploy/entrypoint.mjs /usr/local/lib/cmeet-entrypoint.mjs

RUN chmod 0755 /app/bin/cmeet-cfrm-backend /app/bin/cvld-voucher-bridge \
    && chmod 0644 /app/package.json /app/package-lock.json /app/release-manifest.json \
       /usr/local/lib/cmeet-entrypoint.mjs

ENTRYPOINT ["node", "/usr/local/lib/cmeet-entrypoint.mjs"]
