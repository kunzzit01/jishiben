package com.jishiben.api.ledger;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.jishiben.api.asset.AssetRepository;
import com.jishiben.api.common.ApiException;
import com.jishiben.api.paymentplan.PaymentPlanRepository;
import com.jishiben.api.transaction.TransactionRepository;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InOrder;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class LedgerServiceTest {

    @Mock
    private LedgerRepository ledgers;
    @Mock
    private AssetRepository assets;
    @Mock
    private TransactionRepository transactions;
    @Mock
    private PaymentPlanRepository paymentPlans;

    private LedgerService service() {
        return new LedgerService(ledgers, assets, transactions, paymentPlans);
    }

    @Test
    void refusesToDeleteALedgerThatStillHoldsDataWithoutForce() {
        when(ledgers.findByOwnerIdAndClientUid(1L, "led-1")).thenReturn(Optional.of(ledger(false)));
        when(assets.countByOwnerIdAndLedgerId(1L, 5L)).thenReturn(2L);
        when(transactions.countByOwnerIdAndLedgerId(1L, 5L)).thenReturn(3L);
        when(paymentPlans.countByOwnerIdAndLedgerId(1L, 5L)).thenReturn(1L);

        assertThatThrownBy(() -> service().delete(1L, "led-1", false))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("force=true");
        verify(ledgers, never()).delete(any(Ledger.class));
    }

    @Test
    void aForcedDeleteRemovesChildrenInForeignKeyOrder() {
        when(ledgers.findByOwnerIdAndClientUid(1L, "led-1")).thenReturn(Optional.of(ledger(false)));
        when(assets.countByOwnerIdAndLedgerId(1L, 5L)).thenReturn(1L);
        when(transactions.countByOwnerIdAndLedgerId(1L, 5L)).thenReturn(2L);
        when(paymentPlans.countByOwnerIdAndLedgerId(1L, 5L)).thenReturn(1L);
        when(transactions.deleteAllByLedger(1L, 5L)).thenReturn(2);
        when(paymentPlans.deleteAllByLedger(1L, 5L)).thenReturn(1);
        when(assets.deleteAllByLedger(1L, 5L)).thenReturn(1);

        LedgerDtos.DeleteResult result = service().delete(1L, "led-1", true);

        InOrder order = inOrder(transactions, paymentPlans, assets, ledgers);
        order.verify(transactions).deleteAllByLedger(1L, 5L);
        order.verify(paymentPlans).deleteAllByLedger(1L, 5L);
        order.verify(assets).deleteAllByLedger(1L, 5L);
        order.verify(ledgers).delete(any(Ledger.class));
        assertThat(result.deletedTransactions()).isEqualTo(2);
        assertThat(result.deletedAssets()).isEqualTo(1);
    }

    @Test
    void theDefaultLedgerCanBeDeletedWhenItIsEmpty() {
        when(ledgers.findByOwnerIdAndClientUid(1L, "led-default")).thenReturn(Optional.of(ledger(true)));

        LedgerDtos.DeleteResult result = service().delete(1L, "led-default", false);

        verify(ledgers).delete(any(Ledger.class));
        assertThat(result.clientUid()).isEqualTo("led-default");
        assertThat(result.deletedTransactions()).isZero();
        assertThat(result.deletedAssets()).isZero();
    }

    @Test
    void theDefaultLedgerStillRefusesDeletionWithoutForceWhenItHoldsData() {
        when(ledgers.findByOwnerIdAndClientUid(1L, "led-default")).thenReturn(Optional.of(ledger(true)));
        when(assets.countByOwnerIdAndLedgerId(1L, 5L)).thenReturn(1L);
        when(transactions.countByOwnerIdAndLedgerId(1L, 5L)).thenReturn(4L);
        when(paymentPlans.countByOwnerIdAndLedgerId(1L, 5L)).thenReturn(0L);

        assertThatThrownBy(() -> service().delete(1L, "led-default", false))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("force=true");
        verify(ledgers, never()).delete(any(Ledger.class));
    }

    @Test
    void aForcedDeleteOfTheDefaultLedgerKeepsTheChildDeletionOrder() {
        when(ledgers.findByOwnerIdAndClientUid(1L, "led-default")).thenReturn(Optional.of(ledger(true)));
        when(assets.countByOwnerIdAndLedgerId(1L, 5L)).thenReturn(1L);
        when(transactions.countByOwnerIdAndLedgerId(1L, 5L)).thenReturn(2L);
        when(paymentPlans.countByOwnerIdAndLedgerId(1L, 5L)).thenReturn(1L);
        when(transactions.deleteAllByLedger(1L, 5L)).thenReturn(2);
        when(paymentPlans.deleteAllByLedger(1L, 5L)).thenReturn(1);
        when(assets.deleteAllByLedger(1L, 5L)).thenReturn(1);

        LedgerDtos.DeleteResult result = service().delete(1L, "led-default", true);

        InOrder order = inOrder(transactions, paymentPlans, assets, ledgers);
        order.verify(transactions).deleteAllByLedger(1L, 5L);
        order.verify(paymentPlans).deleteAllByLedger(1L, 5L);
        order.verify(assets).deleteAllByLedger(1L, 5L);
        order.verify(ledgers).delete(any(Ledger.class));
        assertThat(result.deletedTransactions()).isEqualTo(2);
        assertThat(result.deletedPaymentPlans()).isEqualTo(1);
        assertThat(result.deletedAssets()).isEqualTo(1);
    }

    @Test
    void upsertIsIdempotentOnClientUid() {
        Ledger existing = ledger(false);
        when(ledgers.findByOwnerIdAndClientUid(1L, "led-1")).thenReturn(Optional.of(existing));
        when(ledgers.save(any(Ledger.class))).thenAnswer(invocation -> invocation.getArgument(0));

        LedgerDtos.Response response = service().upsert(1L, new LedgerDtos.UpsertRequest(
                "led-1", "Groceries", "cart", "#AABBCC", 3, null, null));

        assertThat(response.clientUid()).isEqualTo("led-1");
        assertThat(response.name()).isEqualTo("Groceries");
        assertThat(response.sortOrder()).isEqualTo(3);
        assertThat(existing.getId()).isEqualTo(5L);
    }

    private static Ledger ledger(boolean isDefault) {
        Ledger ledger = new Ledger();
        ledger.setOwnerId(1L);
        ledger.setClientUid(isDefault ? "led-default" : "led-1");
        ledger.setId(5L);
        ledger.setName("Home");
        ledger.setIcon("home");
        ledger.setDefaultLedger(isDefault);
        return ledger;
    }
}
