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
  it.each([{ activeQuery: null }, { _activeQuery: null }])(
    'should release an idle connection back to the pool (%o)',
    async (connection) => {
      const { release, releaseConnection } =
        await obtainReleaseCallback(connection);

      release();

      expect(releaseConnection).toHaveBeenCalledTimes(1);
      expect(releaseConnection).toHaveBeenCalledWith(undefined);
    },
  );

  it('should pass the release error through for an idle connection', async () => {
    const { release, releaseConnection } = await obtainReleaseCallback({
      activeQuery: null,
    });
    const connectionError = new Error('Connection terminated unexpectedly');

    release(connectionError);

    expect(releaseConnection).toHaveBeenCalledTimes(1);
    expect(releaseConnection).toHaveBeenCalledWith(connectionError);
  });

  it.each([
    { activeQuery: { text: 'DELETE FROM "core"."fieldMetadata"' } },
    { _activeQuery: { text: 'DELETE FROM "core"."fieldMetadata"' } },
  ])(
    'should destroy a connection released while its query is still running (%o)',
    async (connection) => {
      const { release, releaseConnection } =
        await obtainReleaseCallback(connection);

      release();

      expect(releaseConnection).toHaveBeenCalledTimes(1);
      expect(releaseConnection).toHaveBeenCalledWith(expect.any(Error));
    },
  );
});
