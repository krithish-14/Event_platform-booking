FROM nginx:1.27-alpine

RUN rm -f /etc/nginx/conf.d/default.conf
COPY deploy/nginx/nginx.conf /etc/nginx/conf.d/default.conf
COPY deploy/nginx/proxy_params.conf /etc/nginx/proxy_params
COPY frontend /usr/share/nginx/html

EXPOSE 80
HEALTHCHECK --interval=20s --timeout=5s --retries=5 CMD wget -qO- http://127.0.0.1/health >/dev/null 2>&1 || exit 1
