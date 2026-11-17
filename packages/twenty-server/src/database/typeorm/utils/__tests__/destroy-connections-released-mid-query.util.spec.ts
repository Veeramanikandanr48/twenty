import { destroyConnectionsReleasedMidQuery } from 'src/database/typeorm/utils/destroy-connections-released-mid-query.util';

const obtainReleaseCallback = async (connection: object) => {
  const releaseConnection = jest.fn();
  const driver = {
    obtainMasterConnection: jest
      .fn()
      .mockResolvedValue([connection, releaseConnection]),
  };

  destroyConnectionsReleasedMidQuery(driver);

  const [, release] = await driver.obtainMasterConnection();

  return { release, releaseConnection };
};

describe('destroyConnectionsReleasedMidQuery', () => {
  it('should release an idle connection back to the pool', async () => {
    const { release, releaseConnection } = await obtainReleaseCallback({
      activeQuery: null,
    });

    release();

    expect(releaseConnection).toHaveBeenCalledTimes(1);
    expect(releaseConnection).toHaveBeenCalledWith(undefined);
  });

  it('should pass the release error through for an idle connection', async () => {
    const { release, releaseConnection } = await obtainReleaseCallback({
      activeQuery: null,
    });
    const connectionError = new Error('Connection terminated unexpectedly');

    release(connectionError);

    expect(releaseConnection).toHaveBeenCalledTimes(1);
    expect(releaseConnection).toHaveBeenCalledWith(connectionError);
  });

  it('should destroy a connection released while its query is still running', async () => {
    const { release, releaseConnection } = await obtainReleaseCallback({
      activeQuery: { text: 'DELETE FROM "core"."fieldMetadata"' },
    });

    release();

    expect(releaseConnection).toHaveBeenCalledTimes(1);
    expect(releaseConnection).toHaveBeenCalledWith(expect.any(Error));
  });
});
