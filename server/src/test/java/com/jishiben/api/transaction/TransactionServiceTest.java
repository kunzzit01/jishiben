package com.jishiben.api.transaction;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.when;

import com.jishiben.api.asset.Asset;
import com.jishiben.api.asset.AssetRepository;
import com.jishiben.api.common.ApiException;
import com.jishiben.api.profile.ProfileService;
import com.jishiben.api.resolve.RefMaps;
import com.jishiben.api.resolve.ReferenceResolver;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.Map;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;

/**
 * Strictness is relaxed on purpose: the resolver is called once per reference field (including the
 * ones a given test leaves empty), so argument-level strict stubbing would only produce noise.
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class TransactionServiceTest {

    @Mock
    private TransactionRepository transactions;
    @Mock
    private AssetRepository assets;
    @Mock
    private ReferenceResolver references;
    @Mock
    private ProfileService profiles;

    private TransactionService service() {
        return new TransactionService(transactions, assets, references, profiles);
    }

    @Test
    void emptyCategoryStringBecomesNull() {
        stubEmptyReferences();
        when(references.requiredLedger(1L, "led-1")).thenReturn(100L);
        when(references.optionalAsset(1L, "acc-1")).thenReturn(10L);
        when(references.loadMaps(1L)).thenReturn(new RefMaps(Map.of(100L, "led-1"), Map.of(),
                Map.of(10L, "acc-1")));
        when(assets.findById(10L)).thenReturn(Optional.of(asset(1L, "MYR")));
        when(transactions.save(any(Transaction.class))).thenAnswer(invocation -> invocation.getArgument(0));

        TransactionDtos.Response response = service().upsert(1L, new TransactionDtos.UpsertRequest(
                "tx-1", "led-1", "", "acc-1", null, null, "expense", new BigDecimal("23.5"), null,
                null, null, null, LocalDate.of(2024, 5, 1), "lunch", null, null));

        assertThat(response.categoryUid()).isNull();
        assertThat(response.assetUid()).isEqualTo("acc-1");
        assertThat(response.amount()).isEqualTo(new BigDecimal("23.5000"));
        assertThat(response.currency()).isEqualTo("MYR");
    }

    @Test
    void transferComputesTheIncomingAmountFromTheRate() {
        stubEmptyReferences();
        when(references.requiredLedger(1L, "led-1")).thenReturn(100L);
        when(references.optionalAsset(1L, "acc-from")).thenReturn(10L);
        when(references.optionalAsset(1L, "acc-to")).thenReturn(11L);
        when(references.loadMaps(1L)).thenReturn(new RefMaps(Map.of(100L, "led-1"), Map.of(),
                Map.of(10L, "acc-from", 11L, "acc-to")));
        when(assets.findById(10L)).thenReturn(Optional.of(asset(1L, "MYR")));
        when(transactions.save(any(Transaction.class))).thenAnswer(invocation -> invocation.getArgument(0));

        TransactionDtos.Response response = service().upsert(1L, new TransactionDtos.UpsertRequest(
                "tx-2", "led-1", null, null, "acc-from", "acc-to", "transfer", new BigDecimal("100"),
                null, new BigDecimal("3.5"), null, new BigDecimal("2"), LocalDate.of(2024, 5, 2), "",
                null, null));

        assertThat(response.convertedAmount()).isEqualTo(new BigDecimal("350.0000"));
        assertThat(response.exchangeRate()).isEqualTo(new BigDecimal("3.50000000"));
        assertThat(response.assetUid()).isNull();
        assertThat(response.fromAssetUid()).isEqualTo("acc-from");
        assertThat(response.toAssetUid()).isEqualTo("acc-to");
    }

    @Test
    void transferWithoutBothAccountsIsRejected() {
        stubEmptyReferences();
        when(references.requiredLedger(1L, "led-1")).thenReturn(100L);
        when(references.optionalAsset(1L, "acc-from")).thenReturn(10L);

        assertThatThrownBy(() -> service().upsert(1L, new TransactionDtos.UpsertRequest(
                "tx-3", "led-1", null, null, "acc-from", null, "transfer", new BigDecimal("100"),
                null, null, null, null, LocalDate.of(2024, 5, 2), null, null, null)))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("fromAssetUid and toAssetUid");
    }

    @Test
    void expenseDropsRateFeeAndTransferAccounts() {
        stubEmptyReferences();
        when(references.requiredLedger(1L, "led-1")).thenReturn(100L);
        when(references.optionalAsset(1L, "acc-1")).thenReturn(10L);
        when(references.optionalAsset(1L, "acc-2")).thenReturn(11L);
        when(references.loadMaps(1L)).thenReturn(new RefMaps(Map.of(100L, "led-1"), Map.of(),
                Map.of(10L, "acc-1")));
        when(assets.findById(10L)).thenReturn(Optional.of(asset(1L, "USD")));
        when(transactions.save(any(Transaction.class))).thenAnswer(invocation -> invocation.getArgument(0));

        TransactionDtos.Response response = service().upsert(1L, new TransactionDtos.UpsertRequest(
                "tx-4", "led-1", null, "acc-1", null, "acc-2", "expense", new BigDecimal("5"),
                null, new BigDecimal("2"), new BigDecimal("10"), new BigDecimal("1"),
                LocalDate.of(2024, 5, 3), null, null, null));

        assertThat(response.exchangeRate()).isNull();
        assertThat(response.convertedAmount()).isNull();
        assertThat(response.fee()).isNull();
        assertThat(response.fromAssetUid()).isNull();
        assertThat(response.toAssetUid()).isNull();
        assertThat(response.currency()).isEqualTo("USD");
    }

    /**
     * The app books the fee of a transfer as its own expense without an account (so the balance is
     * only charged once). That row must be accepted, and it must fall back to the profile currency.
     */
    @Test
    void expenseWithoutAnAccountIsAcceptedAndFallsBackToTheProfileCurrency() {
        stubEmptyReferences();
        when(references.requiredLedger(1L, "led-1")).thenReturn(100L);
        when(references.loadMaps(1L)).thenReturn(new RefMaps(Map.of(), Map.of(), Map.of()));
        when(transactions.save(any(Transaction.class))).thenAnswer(invocation -> invocation.getArgument(0));

        TransactionDtos.Response response = service().upsert(1L, new TransactionDtos.UpsertRequest(
                "tx-5", "led-1", null, "", null, null, "expense", new BigDecimal("5"), null,
                null, null, null, LocalDate.of(2024, 5, 3), "transfer fee", null, null));

        assertThat(response.assetUid()).isNull();
        assertThat(response.fromAssetUid()).isNull();
        assertThat(response.toAssetUid()).isNull();
        assertThat(response.currency()).isEqualTo("MYR");
        assertThat(response.amount()).isEqualTo(new BigDecimal("5.0000"));
    }

    @Test
    void incomeWithoutAnAccountIsAccepted() {
        stubEmptyReferences();
        when(references.requiredLedger(1L, "led-1")).thenReturn(100L);
        when(references.loadMaps(1L)).thenReturn(new RefMaps(Map.of(), Map.of(), Map.of()));
        when(transactions.save(any(Transaction.class))).thenAnswer(invocation -> invocation.getArgument(0));

        TransactionDtos.Response response = service().upsert(1L, new TransactionDtos.UpsertRequest(
                "tx-6", "led-1", null, null, null, null, "income", new BigDecimal("12.3"), "USD",
                null, null, null, LocalDate.of(2024, 5, 3), null, null, null));

        assertThat(response.assetUid()).isNull();
        assertThat(response.currency()).isEqualTo("USD");
    }

    /** DATETIME has second precision: the echoed value must be the stored value, and written once. */
    @Test
    void auditTimestampsAreSecondPrecisionAndCreatedAtIsWrittenOnce() {
        Transaction row = new Transaction();
        row.onCreate();
        Instant created = row.getCreatedAt();

        assertThat(created.getNano()).isZero();
        assertThat(row.getUpdatedAt()).isEqualTo(created);

        row.onCreate();
        assertThat(row.getCreatedAt()).isEqualTo(created);

        row.onUpdate();
        assertThat(row.getCreatedAt()).isEqualTo(created);
        assertThat(row.getUpdatedAt().getNano()).isZero();
    }

    @Test
    void negativeAmountIsRejected() {
        stubEmptyReferences();
        when(references.requiredLedger(1L, "led-1")).thenReturn(100L);
        when(references.optionalAsset(1L, "acc-1")).thenReturn(10L);

        assertThatThrownBy(() -> service().upsert(1L, new TransactionDtos.UpsertRequest(
                "tx-6", "led-1", null, "acc-1", null, null, "expense", new BigDecimal("-1"), "MYR",
                null, null, null, LocalDate.of(2024, 5, 3), null, null, null)))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("negative");
    }

    /** Mockito answers 0 for a wrapped long, so "no reference" has to be stated explicitly. */
    private void stubEmptyReferences() {
        when(references.requiredLedger(anyLong(), any())).thenReturn(null);
        when(references.optionalCategory(anyLong(), any())).thenReturn(null);
        when(references.optionalAsset(anyLong(), any())).thenReturn(null);
        when(profiles.currency(anyLong())).thenReturn("MYR");
    }

    private static Asset asset(long ownerId, String currency) {
        Asset asset = new Asset();
        asset.setOwnerId(ownerId);
        asset.setCurrency(currency);
        return asset;
    }
}
