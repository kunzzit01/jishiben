package com.jishiben.api.asset;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;

import com.jishiben.api.ledger.LedgerRepository;
import com.jishiben.api.resolve.RefMaps;
import com.jishiben.api.resolve.ReferenceResolver;
import java.math.BigDecimal;
import java.util.Map;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;

/**
 * A negative initial balance is data, not a typo: the app stores a credit card as
 * {@code initialBalance = available − creditLimit}, so "I still owe money" is a negative number
 * (docs/FEATURES.md §8.2: {@code balance < 0} is debt). The column, the reports and the clients all
 * already treat it as signed — 2026-11-03 every credit card with debt failed to back up with
 * "initialBalance must not be negative" because only the amount validator disagreed.
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class AssetServiceTest {

    @Mock
    private AssetRepository assets;
    @Mock
    private LedgerRepository ledgers;
    @Mock
    private ReferenceResolver references;

    private AssetService service() {
        return new AssetService(assets, ledgers, references);
    }

    private void stubSingleLedger() {
        when(references.requiredLedger(1L, "led-1")).thenReturn(100L);
        when(references.loadMaps(1L)).thenReturn(new RefMaps(Map.of(100L, "led-1"), Map.of(), Map.of()));
        when(assets.save(any(Asset.class))).thenAnswer(invocation -> invocation.getArgument(0));
    }

    private static Asset existingCreditCard() {
        Asset asset = new Asset();
        asset.setOwnerId(1L);
        asset.setClientUid("acc-1");
        asset.setLedgerId(100L);
        asset.setName("Visa");
        asset.setIcon("card-outline");
        asset.setColor("#4C9AFF");
        asset.setType("credit");
        asset.setCurrency("MYR");
        asset.setInitialBalance(new BigDecimal("-1000.0000"));
        asset.setCreditLimit(new BigDecimal("5000.0000"));
        asset.setSortOrder(0);
        asset.setDefaultAsset(false);
        return asset;
    }

    @Test
    void upsertAcceptsANegativeInitialBalance() {
        stubSingleLedger();
        when(assets.findByOwnerIdAndClientUid(1L, "acc-1")).thenReturn(Optional.empty());

        // 可用 4000 + 额度 5000 → initialBalance = -1000（已用掉 1000）
        AssetDtos.Response response = service().upsert(1L, new AssetDtos.UpsertRequest(
                "acc-1", "led-1", "Visa", "card-outline", "#4C9AFF", "credit", "MYR",
                new BigDecimal("-1000"), new BigDecimal("5000"), null, null, null, null, null, 0, false));

        assertThat(response.initialBalance()).isEqualTo(new BigDecimal("-1000.0000"));
        assertThat(response.creditLimit()).isEqualTo(new BigDecimal("5000.0000"));
        assertThat(response.ledgerUid()).isEqualTo("led-1");
    }

    @Test
    void patchAcceptsANegativeInitialBalance() {
        stubSingleLedger();
        when(assets.findByOwnerIdAndClientUid(1L, "acc-1"))
                .thenReturn(Optional.of(existingCreditCard()));

        AssetDtos.Response response = service().patch(1L, "acc-1", new AssetDtos.PatchRequest(
                null, null, null, null, null, null, new BigDecimal("-1500.25"), null,
                null, null, null, null, null, null, null));

        assertThat(response.initialBalance()).isEqualTo(new BigDecimal("-1500.2500"));
    }

    @Test
    void oversizedInitialBalanceIsStillRejected() {
        stubSingleLedger();
        when(assets.findByOwnerIdAndClientUid(1L, "acc-1")).thenReturn(Optional.empty());

        AssetDtos.UpsertRequest request = new AssetDtos.UpsertRequest(
                "acc-1", "led-1", "Visa", "card-outline", "#4C9AFF", "credit", "MYR",
                new BigDecimal("-1000000000002"), new BigDecimal("5000"), null, null, null, null, null, 0,
                false);
        org.assertj.core.api.Assertions.assertThatThrownBy(() -> service().upsert(1L, request))
                .isInstanceOf(com.jishiben.api.common.ApiException.class)
                .hasMessageContaining("too large");
    }
}
