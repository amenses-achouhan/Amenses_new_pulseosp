import GoogleProvider from 'next-auth/providers/google';
import GitHubProvider from 'next-auth/providers/github';
import CredentialsProvider from 'next-auth/providers/credentials';

const API_BASE =
  process.env.NEXT_PUBLIC_EXPRESS_API_URL ||
  process.env.NEXT_PUBLIC_API_URL ||
  'http://localhost:5000';

/** @type {import('next-auth').AuthOptions} */
export const authOptions = {
  providers: [
    CredentialsProvider({
      name: 'Credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
        inviteToken: { label: 'Invite token', type: 'text' },
        // Used by the email-OTP flow: a freshly-minted verification JWT let the
        // just-verified user start an authenticated session without re-entering the
        // password. Not the plaintext password and never exposed in URLs.
        verifiedToken: { label: 'Verified session token', type: 'text' },
      },
      async authorize(credentials) {
        if (!credentials?.email) return null;
        const hasPassword = !!credentials?.password;
        const hasVerifiedToken = !!credentials?.verifiedToken;
        if (!hasPassword && !hasVerifiedToken) return null;

        let res;
        try {
          res = await fetch(`${API_BASE}/api/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              email: credentials.email,
              ...(credentials.password ? { password: credentials.password } : {}),
              ...(credentials.verifiedToken
                ? { verifiedToken: credentials.verifiedToken }
                : {}),
              ...(credentials.inviteToken
                ? { inviteToken: credentials.inviteToken }
                : {}),
            }),
          });
        } catch (error) {
          const err = new Error(
            'Could not reach the authentication server. Please try again.'
          );
          err.code = 'NETWORK_ERROR';
          err.status = 0;
          throw err;
        }

        if (!res.ok) {
          let message = `Login failed (${res.status}).`;
          let code = null;
          try {
            const body = await res.json();
            if (body?.message) message = body.message;
            code = body?.code || null;
          } catch (_) {
          }
          const err = new Error(message);
          err.code = code || `HTTP_${res.status}`;
          err.status = res.status;
          throw err;
        }

        const data = await res.json();
        const user = data.user || {};
        return {
          id: user.id,
          email: user.email,
          name: user.name || user.email,
          accessToken: data.token,
          activeOrganizationId: user.activeOrganizationId || null,
          role: user.role || 'member',
          mustChangePassword: user.mustChangePassword || false,
          themeSettings: user.themeSettings || null,
          hasWorkspace: user.hasWorkspace ?? !!user.activeOrganizationId,
          workspaceCount: user.workspaceCount ?? 0,
          workspaces: Array.isArray(user.workspaces) ? user.workspaces : [],
          isInvitedUser: Boolean(user.isInvitedUser),
        };
      },
    }),

    ...(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
      ? [
        GoogleProvider({
          clientId: process.env.GOOGLE_CLIENT_ID,
          clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        }),
      ]
      : []),

    ...(process.env.GITHUB_AUTH_CLIENT_ID && process.env.GITHUB_AUTH_CLIENT_SECRET
      ? [
        GitHubProvider({
          clientId: process.env.GITHUB_AUTH_CLIENT_ID,
          clientSecret: process.env.GITHUB_AUTH_CLIENT_SECRET,
        }),
      ]
      : []),
  ],
  session: { strategy: 'jwt' },
  secret: process.env.NEXTAUTH_SECRET || process.env.JWT_SECRET,

  callbacks: {
    async signIn({ user, account, profile, email }) {
      if (!account || account.provider === 'credentials') return true;

      const payload = {
        email: (user?.email || email || profile?.email || '').toLowerCase().trim(),
        name: user?.name || profile?.name || profile?.login || '',
      };
      if (profile?.inviteToken) payload.inviteToken = profile.inviteToken;

      try {
        const res = await fetch(`${API_BASE}/api/auth/oauth/sync`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

        if (!res.ok) {
          console.error(`[next-auth] oauth/sync failed (${res.status})`);
          return false;
        }

        const data = await res.json();
        const u = data.user || {};
        user.accessToken = data.token;
        user.id = user.id || u.id;
        user.activeOrganizationId = u.activeOrganizationId || null;
        user.role = u.role || 'member';
        user.mustChangePassword = u.mustChangePassword || false;
        user.themeSettings = u.themeSettings || null;
        user.hasWorkspace = u.hasWorkspace ?? !!u.activeOrganizationId;
        user.workspaceCount = u.workspaceCount ?? 0;
        user.workspaces = Array.isArray(u.workspaces) ? u.workspaces : [];
        user.isInvitedUser = Boolean(u.isInvitedUser);
      } catch (error) {
        console.error('[next-auth] oauth/sync network error:', error.message);
        return false;
      }
      return true;
    },

    async jwt({ token, user, trigger, session }) {
      if (user) {
        const userWorkspaces = Array.isArray(user.workspaces) ? user.workspaces : [];
        const activeOrgId = user.activeOrganizationId || (userWorkspaces[0]?.id ?? null);
        const userHasWs = user.hasWorkspace ?? (userWorkspaces.length > 0 || !!activeOrgId);

        token.accessToken = user.accessToken || null;
        token.userId = user.id;
        token.activeOrganizationId = activeOrgId;
        token.role = user.role || 'member';
        token.mustChangePassword = user.mustChangePassword || false;
        token.themeSettings = user.themeSettings || null;
        token.hasWorkspace = userHasWs;
        token.workspaceCount = user.workspaceCount ?? userWorkspaces.length;
        token.workspaces = userWorkspaces;
        token.isInvitedUser = user.isInvitedUser || false;
      }
      if (trigger === 'update' && session) {
        if (session.accessToken !== undefined) token.accessToken = session.accessToken;
        if (session.activeOrganizationId !== undefined)
          token.activeOrganizationId = session.activeOrganizationId;
        if (session.role !== undefined) token.role = session.role;
        if (session.mustChangePassword !== undefined)
          token.mustChangePassword = session.mustChangePassword;
        if (session.themeSettings !== undefined) token.themeSettings = session.themeSettings;
        // Allow session updates to refresh workspace data too.
        if (session.hasWorkspace !== undefined) token.hasWorkspace = session.hasWorkspace;
        if (session.workspaceCount !== undefined) token.workspaceCount = session.workspaceCount;
        if (session.workspaces !== undefined) token.workspaces = session.workspaces;
        if (session.isInvitedUser !== undefined) token.isInvitedUser = session.isInvitedUser;
      }
      return token;
    },

    async session({ session, token }) {
      session.accessToken = token.accessToken || null;
      if (session.user) {
        const userWorkspaces = Array.isArray(token.workspaces) ? token.workspaces : [];
        const activeOrgId = token.activeOrganizationId || (userWorkspaces[0]?.id ?? null);
        const userHasWs = token.hasWorkspace ?? (userWorkspaces.length > 0 || !!activeOrgId);

        session.user.id = token.userId;
        session.user.activeOrganizationId = activeOrgId;
        session.user.role = token.role || null;
        session.user.mustChangePassword = token.mustChangePassword || false;
        session.user.themeSettings = token.themeSettings || null;
        session.user.hasWorkspace = userHasWs;
        session.user.workspaceCount = token.workspaceCount ?? userWorkspaces.length;
        session.user.workspaces = userWorkspaces;
        session.user.isInvitedUser = token.isInvitedUser || false;
      }
      return session;
    },
    async redirect({ url, baseUrl }) {
      // After OAuth sign-in the callbackUrl is '/workspace'. The middleware then
      // redirects to /workspace/[id] using the JWT token. Allow relative URLs.
      if (url.startsWith('/')) return `${baseUrl}${url}`;
      if (new URL(url).origin === baseUrl) return url;
      return baseUrl;
    },
  },

  pages: { signIn: '/login', error: '/login' },
};
