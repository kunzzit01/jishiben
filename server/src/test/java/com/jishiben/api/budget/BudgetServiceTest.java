package com.jishiben.api.budget;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;

import com.jishiben.api.common.ApiException;
import com.jishiben.api.common.ErrorCode;
import com.jishiben.api.profile.ProfileService;
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

@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class BudgetServiceTest {

    @Mock
    private BudgetRepository budgets;
    @Mock
    private ReferenceResolver references;
    @Mock
    private ProfileService profiles;

    private BudgetService service() {
        return new BudgetService(budgets, references, profiles);
    }

    @Test
    void totalMagicValueBecomesScopeTotalWithNoCategory() {
        when(profiles.currency(1L)).thenReturn("MYR");
        when(budgets.findByOwnerIdAndScopeAndCurrencyAndCategoryIdIsNull(1L, "total", "MYR"))
                .thenReturn(Optional.empty());
        when(budgets.findByOwnerIdAndClientUid(1L, "total|MYR")).thenReturn(Optional.empty());
        when(budgets.save(any(Budget.class))).thenAnswer(invocation -> invocation.getArgument(0));
        when(references.loadMaps(1L)).thenReturn(new RefMaps(Map.of(), Map.of(), Map.of()));

        BudgetDtos.Response response = service().upsert(1L,
                new BudgetDtos.UpsertRequest(null, "total", new BigDecimal("1500"), null));

        assertThat(response.scope()).isEqualTo("total");
        assertThat(response.categoryUid()).isNull();
        assertThat(response.currency()).isEqualTo("MYR");
        assertThat(response.clientUid()).isEqualTo("total|MYR");
    }

    @Test
    void blankCategoryIsAlsoTheOverallBudget() {
        when(budgets.findByOwnerIdAndScopeAndCurrencyAndCategoryIdIsNull(1L, "total", "MYR"))
                .thenReturn(Optional.empty());
        when(budgets.findByOwnerIdAndClientUid(1L, "total|MYR")).thenReturn(Optional.empty());
        when(budgets.save(any(Budget.class))).thenAnswer(invocation -> invocation.getArgument(0));
        when(references.loadMaps(1L)).thenReturn(new RefMaps(Map.of(), Map.of(), Map.of()));

        BudgetDtos.Response response = service().upsert(1L,
                new BudgetDtos.UpsertRequest(null, "", new BigDecimal("99"), "myr"));

        assertThat(response.scope()).isEqualTo("total");
        assertThat(response.currency()).isEqualTo("MYR");
    }

    @Test
    void categoryBudgetKeepsTheResolvedCategory() {
        when(references.optionalCategory(1L, "cat-food")).thenReturn(7L);
        when(budgets.findByOwnerIdAndScopeAndCurrencyAndCategoryId(1L, "category", "MYR", 7L))
                .thenReturn(Optional.empty());
        when(budgets.findByOwnerIdAndClientUid(1L, "cat-food|MYR")).thenReturn(Optional.empty());
        when(budgets.save(any(Budget.class))).thenAnswer(invocation -> invocation.getArgument(0));
        when(references.loadMaps(1L)).thenReturn(new RefMaps(Map.of(), Map.of(7L, "cat-food"), Map.of()));

        BudgetDtos.Response response = service().upsert(1L,
                new BudgetDtos.UpsertRequest(null, "cat-food", new BigDecimal("300"), "MYR"));

        assertThat(response.scope()).isEqualTo("category");
        assertThat(response.categoryUid()).isEqualTo("cat-food");
        assertThat(response.clientUid()).isEqualTo("cat-food|MYR");
    }

    @Test
    void blankCurrencyIsFrozenToTheGlobalCurrencyAtWriteTime() {
        when(profiles.currency(1L)).thenReturn("SGD");
        when(budgets.findByOwnerIdAndScopeAndCurrencyAndCategoryIdIsNull(1L, "total", "SGD"))
                .thenReturn(Optional.empty());
        when(budgets.findByOwnerIdAndClientUid(1L, "total|SGD")).thenReturn(Optional.empty());
        when(budgets.save(any(Budget.class))).thenAnswer(invocation -> invocation.getArgument(0));
        when(references.loadMaps(1L)).thenReturn(new RefMaps(Map.of(), Map.of(), Map.of()));

        BudgetDtos.Response response = service().upsert(1L,
                new BudgetDtos.UpsertRequest(null, "total", new BigDecimal("10"), ""));

        assertThat(response.currency()).isEqualTo("SGD");
    }

    @Test
    void zeroAmountIsRefusedInsteadOfStored() {
        assertThatThrownBy(() -> service().upsert(1L,
                new BudgetDtos.UpsertRequest(null, "total", BigDecimal.ZERO, "MYR")))
                .isInstanceOf(ApiException.class)
                .extracting("code").isEqualTo(ErrorCode.VALIDATION_FAILED);
    }

    @Test
    void theExistingRowForTheSameBusinessKeyIsUpdatedRatherThanDuplicated() {
        Budget existing = new Budget();
        existing.setId(3L);
        existing.setOwnerId(1L);
        existing.setClientUid("stale-uid");
        existing.setScope("total");
        existing.setCurrency("MYR");
        existing.setAmount(new BigDecimal("1.0000"));
        when(profiles.currency(1L)).thenReturn("MYR");
        when(budgets.findByOwnerIdAndScopeAndCurrencyAndCategoryIdIsNull(1L, "total", "MYR"))
                .thenReturn(Optional.of(existing));
        when(budgets.save(any(Budget.class))).thenAnswer(invocation -> invocation.getArgument(0));
        when(references.loadMaps(1L)).thenReturn(new RefMaps(Map.of(), Map.of(), Map.of()));

        BudgetDtos.Response response = service().upsert(1L,
                new BudgetDtos.UpsertRequest("total|MYR", "total", new BigDecimal("42.5"), "MYR"));

        assertThat(response.amount()).isEqualTo(new BigDecimal("42.5000"));
        assertThat(existing.getId()).isEqualTo(3L);
        assertThat(existing.getClientUid()).isEqualTo("total|MYR");
    }
}
