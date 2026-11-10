package com.jishiben.api.premium;

import static org.mockito.Mockito.*;

import com.jishiben.api.auth.GoogleTokenVerifier;
import com.jishiben.api.security.AuthPrincipal;
import com.jishiben.api.user.User;
import com.jishiben.api.user.UserRepository;
import java.nio.charset.StandardCharsets;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.function.Supplier;
import org.h2.jdbcx.JdbcDataSource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.transaction.support.TransactionTemplate;

/** H2 (MySQL mode) database with the real V13 migration, plus helpers shared by billing tests. */
class BillingFixture {
    static final String ADMIN_EMAIL = "mingsoon249@gmail.com";
    static final String ADMIN_SUB = "google-sub-owner";

    final JdbcDataSource ds = new JdbcDataSource();
    final JdbcTemplate jdbc;
    final DataSourceTransactionManager transactions;
    final TransactionTemplate tx;
    final UserRepository users = mock(UserRepository.class);

    BillingFixture() throws Exception {
        ds.setURL("jdbc:h2:mem:" + UUID.randomUUID() + ";MODE=MySQL;DB_CLOSE_DELAY=-1;DATABASE_TO_LOWER=TRUE");
        jdbc = new JdbcTemplate(ds);
        jdbc.execute("CREATE TABLE users(id BIGINT UNSIGNED PRIMARY KEY, email VARCHAR(255))");
        jdbc.update("INSERT INTO users VALUES (1,'mingsoon249@gmail.com'), (2,'other@example.com'), (3,'third@example.com')");
        try (var stream = getClass().getResourceAsStream("/db/migration/V13__create_subscription_sandbox.sql")) {
            String sql = new String(stream.readAllBytes(), StandardCharsets.UTF_8)
                    .replaceAll("(?m)^\\s*--.*$", "")
                    .replaceAll("ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci", "")
                    .replaceAll(" ON UPDATE CURRENT_TIMESTAMP", "");
            for (String statement : sql.split(";")) if (!statement.isBlank()) jdbc.execute(statement);
        }
        transactions = new DataSourceTransactionManager(ds);
        tx = new TransactionTemplate(transactions);
        user(1, ADMIN_EMAIL, ADMIN_SUB);
        user(2, "other@example.com", null);
        user(3, "third@example.com", null);
    }

    void user(long id, String email, String googleSub) {
        User u = new User();
        u.setEmail(email);
        u.setUserRole("USER");
        u.setGoogleSub(googleSub);
        when(users.findById(id)).thenReturn(Optional.of(u));
    }

    static BillingProperties staging() {
        return new BillingProperties("staging", true, true, ADMIN_EMAIL, "", 7);
    }

    BillingAdminService admins(BillingProperties props) {
        return new BillingAdminService(jdbc, users, props);
    }

    PremiumService service(BillingProperties props) {
        return new PremiumService(jdbc, props, admins(props));
    }

    /** Pins the administrator the way a real Google sign-in does. */
    void pinAdmin(BillingAdminService admins) {
        User u = new User();
        u.setEmail(ADMIN_EMAIL);
        admins.onGoogleSignIn(u, new GoogleTokenVerifier.GoogleIdentity(ADMIN_SUB, ADMIN_EMAIL, true, "Owner", null));
    }

    static void signIn(long id, String email, String method) {
        SecurityContextHolder.getContext().setAuthentication(new UsernamePasswordAuthenticationToken(
                new AuthPrincipal(id, email, "USER", 0, method), null, List.of()));
    }

    static void signOut() { SecurityContextHolder.clearContext(); }

    <T> T inTx(Supplier<T> work) { return tx.execute(status -> work.get()); }

    void open(boolean gates) {
        jdbc.update("UPDATE billing_settings SET enrollment_open=TRUE, sandbox_open=TRUE, gates_enabled=? WHERE id=1", gates);
    }

    static Timestamp ts(Instant value) { return Timestamp.from(value); }
}
