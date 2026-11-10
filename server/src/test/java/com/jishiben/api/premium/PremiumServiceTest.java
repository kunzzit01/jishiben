package com.jishiben.api.premium;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;
import com.jishiben.api.common.ApiException;
import com.jishiben.api.security.AuthPrincipal;
import com.jishiben.api.user.User;
import com.jishiben.api.user.UserRepository;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.Callable;
import org.h2.jdbcx.JdbcDataSource;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.transaction.support.TransactionTemplate;

class PremiumServiceTest {
    JdbcTemplate jdbc;
    UserRepository users;
    PremiumService service;
    TransactionTemplate tx;
    @BeforeEach void setUp() throws Exception {
        JdbcDataSource ds = new JdbcDataSource();
        ds.setURL("jdbc:h2:mem:" + UUID.randomUUID() + ";MODE=MySQL;DB_CLOSE_DELAY=-1;DATABASE_TO_LOWER=TRUE");
        jdbc = new JdbcTemplate(ds);
        jdbc.execute("CREATE TABLE users(id BIGINT PRIMARY KEY,email VARCHAR(255))");
        jdbc.update("INSERT INTO users VALUES(1,'mingsoon249@gmail.com'),(2,'other@example.com')");
        try (var stream = getClass().getResourceAsStream("/db/migration/V13__create_subscription_sandbox.sql")) {
            String sql = new String(stream.readAllBytes(), StandardCharsets.UTF_8)
                    .replaceAll("(?m)^--.*$", "").replaceAll("ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci", "")
                    .replaceAll(" ON UPDATE CURRENT_TIMESTAMP", "");
            for (String statement : sql.split(";")) if (!statement.isBlank()) jdbc.execute(statement);
        }
        users = mock(UserRepository.class);
        service = new PremiumService(jdbc, users, true, "SANDBOX", "mingsoon249@gmail.com");
        tx = new TransactionTemplate(new DataSourceTransactionManager(ds));
    }
    @AfterEach void clear() { SecurityContextHolder.clearContext(); }
    <T> T transaction(java.util.function.Supplier<T> run) { return tx.execute(s -> run.get()); }
    void open() { jdbc.update("UPDATE billing_settings SET enrollment_open=TRUE,sandbox_open=TRUE,gates_enabled=TRUE WHERE id=1"); }
    void signIn(long id, String email) {
        SecurityContextHolder.getContext().setAuthentication(new UsernamePasswordAuthenticationToken(new AuthPrincipal(id,email,"ADMIN",0),null,List.of()));
    }
    User user(boolean verified) {
        User u = new User(); u.setEmail("mingsoon249@gmail.com"); u.setUserRole("USER");
        if (verified) { u.setGoogleSub("verified-google-sub"); u.setEmailVerifiedAt(Instant.now()); }
        return u;
    }
    @Test void unverifiedEmailAndForgedRoleCannotGetAdministratorPrivileges() {
        signIn(1,"mingsoon249@gmail.com"); when(users.findById(1L)).thenReturn(Optional.of(user(false)));
        assertThat(service.isAdministrator()).isFalse();
        assertThatThrownBy(service::console).isInstanceOf(ApiException.class);
        when(users.findById(1L)).thenReturn(Optional.of(user(true)));
        assertThat(service.isAdministrator()).isTrue();
    }
    @Test void guestApplicationApprovalAndCancellationFollowTheSameEntitlementPolicy() {
        open();
        String guest = service.createGuest().token();
        var application = new PremiumDtos.Application("monthly", "apply-1");
        var pending = transaction(() -> service.apply(guest, application));
        assertThat(pending.active()).isFalse();
        assertThat(pending.capabilities().get("scan")).isFalse();
        assertThat(pending.capabilities().get("reminders")).isTrue();
        transaction(() -> service.apply(guest, application));
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM billing_subscriptions", Integer.class)).isEqualTo(1);
        var order = pending.subscriptions().getFirst();
        signIn(1,"mingsoon249@gmail.com"); when(users.findById(1L)).thenReturn(Optional.of(user(true)));
        var event = new PremiumDtos.Event("APPROVE", "approval-1", 0);
        transaction(() -> service.simulate(order.id(), event));
        transaction(() -> service.simulate(order.id(), event));
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM billing_events", Integer.class)).isEqualTo(1);
        SecurityContextHolder.clearContext();
        var paid = service.status(guest);
        assertThat(paid.active()).isTrue();
        var canceled = transaction(() -> service.cancelSandbox(guest, order.id(), new PremiumDtos.Event("CANCEL","cancel-1",1)));
        assertThat(canceled.active()).isTrue();
        assertThat(canceled.expiresAt()).isEqualTo(paid.expiresAt());
        assertThat(canceled.subscriptions().getFirst().autoRenew()).isFalse();
    }
    @Test void guestClaimsRequireSecretAndCanOnlyBeClaimedOnce() {
        open(); String guest=service.createGuest().token();
        transaction(() -> service.apply(guest,new PremiumDtos.Application("yearly","key")));
        signIn(2,"other@example.com");
        transaction(() -> { service.claimGuest(guest); return null; });
        assertThat(service.status(null).subscriptions()).hasSize(1);
        assertThatThrownBy(() -> transaction(() -> { service.claimGuest(guest); return null; })).isInstanceOf(ApiException.class);
        SecurityContextHolder.clearContext();
        assertThatThrownBy(() -> service.status(guest)).isInstanceOf(ApiException.class);
        assertThatThrownBy(() -> service.status("x".repeat(72))).isInstanceOf(ApiException.class);
    }
    @Test void disabledServerSandboxCannotBeEnabledByAnAdministrator() {
        service = new PremiumService(jdbc,users,false,"SANDBOX","mingsoon249@gmail.com");
        signIn(1,"mingsoon249@gmail.com"); when(users.findById(1L)).thenReturn(Optional.of(user(true)));
        assertThatThrownBy(() -> transaction(() -> service.updateSettings(new PremiumDtos.Settings(true,true,true)))).isInstanceOf(ApiException.class);
    }
    @Test void productionModeNeverAcceptsSimulatedPurchaseOrSimulatedEntitlement() {
        open(); String guest=service.createGuest().token();
        var pending = transaction(() -> service.apply(guest,new PremiumDtos.Application("monthly","key")));
        jdbc.update("UPDATE billing_subscriptions SET subscription_state='ACTIVE',expires_at=?", java.sql.Timestamp.from(Instant.now().plusSeconds(3600)));
        service = new PremiumService(jdbc,users,true,"GOOGLE_PLAY","mingsoon249@gmail.com");
        assertThat(service.status(guest).active()).isFalse();
        assertThatThrownBy(() -> transaction(() -> service.apply(guest,new PremiumDtos.Application("monthly","other")))).isInstanceOf(ApiException.class);
    }
    @Test void duplicateConcurrentApplicationsCannotCreateTwoOrders() throws Exception {
        open(); String guest=service.createGuest().token();
        try (var pool = java.util.concurrent.Executors.newFixedThreadPool(2)) {
            Callable<PremiumDtos.Status> work = () -> transaction(() -> service.apply(guest,new PremiumDtos.Application("monthly","same-key")));
            for (var result : pool.invokeAll(List.of(work,work))) assertThat(result.get().subscriptions()).hasSize(1);
        }
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM billing_subscriptions",Integer.class)).isEqualTo(1);
    }
    GooglePlayGateway google() { return mock(GooglePlayGateway.class); }
    GooglePlayGateway.Verified verified(String state, String account) {
        return new GooglePlayGateway.Verified(state, Instant.now().plusSeconds(3600), "monthly", true, false, account, "", "");
    }
    @Test void realPurchasesAreGrantedFromVerifiedStateAndAcknowledgedInASeparateDurablePhase() {
        open(); service = new PremiumService(jdbc,users,false,"GOOGLE_PLAY","mingsoon249@gmail.com");
        String guest = service.createGuest().token();
        var status = service.status(guest);
        var google = google();
        when(google.verify("real-token")).thenReturn(verified("ACTIVE",status.obfuscatedAccountId()));
        when(google.encrypt("real-token")).thenReturn("encrypted-token");
        when(google.decrypt("encrypted-token")).thenReturn("real-token");
        var billing = new GoogleBillingService(service,google,new com.fasterxml.jackson.databind.ObjectMapper());
        assertThat(transaction(() -> billing.verify(guest,"real-token",false)).active()).isTrue();
        verify(google,never()).acknowledge(anyString());
        String hash = PremiumService.digest("real-token");
        transaction(() -> { billing.reconcile(hash); return null; });
        verify(google).acknowledge("real-token");
        assertThat(jdbc.queryForObject("SELECT acknowledged FROM billing_subscriptions",Boolean.class)).isTrue();
    }
    @Test void pendingGooglePurchasesDoNotGrantAccessOrGetAcknowledged() {
        open(); service = new PremiumService(jdbc,users,false,"GOOGLE_PLAY","mingsoon249@gmail.com");
        String guest = service.createGuest().token(); var status = service.status(guest); var google = google();
        when(google.verify("pending-token")).thenReturn(verified("PENDING",status.obfuscatedAccountId()));
        when(google.encrypt("pending-token")).thenReturn("cipher"); when(google.decrypt("cipher")).thenReturn("pending-token");
        var billing = new GoogleBillingService(service,google,new com.fasterxml.jackson.databind.ObjectMapper());
        assertThat(transaction(() -> billing.verify(guest,"pending-token",false)).active()).isFalse();
        transaction(() -> { billing.reconcile(PremiumService.digest("pending-token")); return null; });
        verify(google,never()).acknowledge(anyString());
    }
    @Test void copiedPurchaseTokenCannotBindToADifferentAccount() {
        open(); service = new PremiumService(jdbc,users,false,"GOOGLE_PLAY","mingsoon249@gmail.com");
        String guest = service.createGuest().token(); var status = service.status(guest); var google = google();
        when(google.verify("owned-token")).thenReturn(verified("ACTIVE",status.obfuscatedAccountId()));
        when(google.encrypt("owned-token")).thenReturn("cipher");
        var billing = new GoogleBillingService(service,google,new com.fasterxml.jackson.databind.ObjectMapper());
        transaction(() -> billing.verify(guest,"owned-token",false));
        signIn(2,"other@example.com");
        assertThatThrownBy(() -> transaction(() -> billing.verify(null,"owned-token",true))).isInstanceOf(ApiException.class);
        assertThat(service.status(null).active()).isFalse();
    }
    @Test void googleAccountMappingMustMatchEvenForTheFirstPurchase() {
        open(); service = new PremiumService(jdbc,users,false,"GOOGLE_PLAY","mingsoon249@gmail.com");
        String guest = service.createGuest().token(); var google = google();
        when(google.verify("forged")).thenReturn(verified("ACTIVE","different-account"));
        var billing = new GoogleBillingService(service,google,new com.fasterxml.jackson.databind.ObjectMapper());
        assertThatThrownBy(() -> transaction(() -> billing.verify(guest,"forged",false))).isInstanceOf(ApiException.class);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM billing_subscriptions",Integer.class)).isZero();
    }

}
