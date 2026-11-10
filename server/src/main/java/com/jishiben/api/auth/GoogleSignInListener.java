package com.jishiben.api.auth;

import com.jishiben.api.user.User;

/** Notified inside the sign-in transaction after Google has verified the identity token. */
public interface GoogleSignInListener {
    void onGoogleSignIn(User user, GoogleTokenVerifier.GoogleIdentity identity);
}
