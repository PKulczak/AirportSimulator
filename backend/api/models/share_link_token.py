import secrets


def generate_share_token():
    """url-safe, ~43 chars from 32 random bytes — long/random enough that
    knowing it is itself the credential for read-only access. Shared by every
    share-link model (single run, batch, compare) so the same generation
    logic/entropy backs all of them.
    """
    return secrets.token_urlsafe(32)
