# G-T16 backup service (D-07): daily pg_dump -Fc into /backups, 14-day retention.
FROM postgres:16
COPY backup.sh /usr/local/bin/backup.sh
RUN chmod 0755 /usr/local/bin/backup.sh
CMD ["backup.sh"]
