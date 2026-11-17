import { Logger } from '@nestjs/common';

import { type PostgresDriver } from 'typeorm/driver/postgres/PostgresDriver';
import { isDefined } from 'twenty-shared/utils';

const logger = new Logger('destroyConnectionsReleasedMidQuery');

const hasActiveQueryField = (connection: object): boolean =>
  '_activeQuery' in connection || 'activeQuery' in connection;

const hasQueryInFlight = (connection: object): boolean => {
  if ('_activeQuery' in connection) {
    return isDefined(connection._activeQuery);
  }

  return 'activeQuery' in connection && isDefined(connection.activeQuery);
};

export const destroyConnectionsReleasedMidQuery = (
  driver: Pick<PostgresDriver, 'obtainMasterConnection'>,
): void => {
  const obtainMasterConnection = driver.obtainMasterConnection.bind(driver);
  let isMissingActiveQueryFieldLogged = false;

  driver.obtainMasterConnection = async () => {
    const [connection, releaseConnection] = await obtainMasterConnection();

    if (!isMissingActiveQueryFieldLogged && !hasActiveQueryField(connection)) {
      isMissingActiveQueryFieldLogged = true;

      logger.warn(
        'pg client exposes no active query field, connections released mid-query go back to the pool',
      );
    }

    const releaseOrDestroyConnection = (error?: Error) => {
      if (isDefined(error) || !hasQueryInFlight(connection)) {
        releaseConnection(error);

        return;
      }

      logger.warn(
        'Destroying core connection released while a query is still running',
      );

      releaseConnection(
        new Error('Connection released while a query is still running'),
      );
    };

    return [connection, releaseOrDestroyConnection];
  };
};
