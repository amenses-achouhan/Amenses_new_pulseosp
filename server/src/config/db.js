const mongoose = require('mongoose');
const dns = require('dns');

const redactMongoUri = (uri) => {
  try {
    const url = new URL(uri);
    if (url.username) {
      url.username = '***';
    }
    if (url.password) {
      url.password = '***';
    }
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return uri ? '[redacted]' : '(not set)';
  }
};

/**
 * Resolve a mongodb+srv cluster host through public DNS resolvers and produce
 * an equivalent direct `mongodb://` seed-list URI. Fallback for environments
 * where the OS resolver cannot answer the `_mongodb._tcp` SRV lookup.
 */
function resolveSrvViaPublicDns(host) {
  return new Promise((resolve, reject) => {
    const resolver = new dns.Resolver();
    resolver.setServers(['8.8.8.8', '1.1.1.1']);
    const timer = setTimeout(() => reject(new Error('public DNS SRV lookup timed out')), 6000);
    resolver.resolveSrv(`_mongodb._tcp.${host}`, (err, addresses) => {
      clearTimeout(timer);
      if (err || !addresses || addresses.length === 0) {
        reject(err || new Error('no SRV records returned'));
        return;
      }
      resolve(addresses.map((a) => `${a.name}:${a.port}`).join(','));
    });
  });
}

/** Convert `mongodb+srv://creds@host/db?params` to a direct seed-list URI. */
async function toDirectUri(mongoURI) {
  const match = mongoURI.match(/^mongodb\+srv:\/\/([^@/]+:[^@/]*)@([^/?#]+)(\/[^?]*)?(\?.*)?$/);
  if (!match) return null;
  const [, credentials, host, dbPath = '', rawQuery = ''] = match;

  console.log('↻  Retrying MongoDB discovery via public DNS resolvers…');
  const hosts = await resolveSrvViaPublicDns(host);

  const params = new URLSearchParams(rawQuery.replace(/^\?/, ''));
  if (!params.has('tls')) params.set('tls', 'true');
  if (!params.has('authSource')) params.set('authSource', 'admin');
  return `mongodb://${credentials}@${hosts}${dbPath || '/admin'}?${params.toString()}`;
}

const connectDB = async () => {
  const mongoURI = process.env.MONGO_URI;
  if (!mongoURI) {
    console.error('[db] MONGO_URI is not set. Add it to server/.env');
    process.exit(1);
  }
  try {
    console.log(`Connecting to MongoDB at: ${redactMongoUri(mongoURI)}`);

    await mongoose.connect(mongoURI, {
      serverSelectionTimeoutMS: 10000,
    });

    console.log('✅ MongoDB connected');
} catch (err) {
  const sanitized = redactMongoUri(mongoURI);
  console.error(`MongoDB connection failed. URI: ${sanitized}`);
  console.error(`Error: ${err?.name ?? 'Unknown'} — ${err?.code ?? 'no code'}`);

  // SRV environments can fail when the OS resolver cannot answer the
  // `_mongodb._tcp` record even though the cluster is reachable. Retry once by
  // resolving through public DNS and connecting with a direct seed list.
  if (/^mongodb\+srv:\/\//.test(mongoURI)) {
    try {
      const directUri = await toDirectUri(mongoURI);
      if (directUri) {
        await mongoose.connect(directUri, { serverSelectionTimeoutMS: 10000 });
        console.log('✅ MongoDB connected (via public-DNS resolved seed list)');
        return;
      }
    } catch (retryErr) {
      console.error(`Direct-URI retry also failed: ${retryErr?.message ?? retryErr}`);
    }
  }

  // Production keeps fail-fast. In development we continue so the server (and
  // the client dev loop against it) still boots — DB-backed routes will return
  // clean per-request errors until the database is reachable again.
  if (process.env.NODE_ENV === 'production') {
    process.exit(1);
  }
  console.warn('⚠️  Development mode: continuing WITHOUT a database connection. '
    + 'Database-backed endpoints will fail per-request until Mongo is reachable.');
}

};

module.exports = connectDB;