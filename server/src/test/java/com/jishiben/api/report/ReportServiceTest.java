package com.jishiben.api.report;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.when;

import com.jishiben.api.asset.Asset;
import com.jishiben.api.asset.AssetRepository;
import com.jishiben.api.category.Category;
import com.jishiben.api.category.CategoryRepository;
import com.jishiben.api.transaction.TransactionRepository;
import java.math.BigDecimal;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class ReportServiceTest {

    private final Clock clock = Clock.fixed(Instant.parse("2024-05-15T00:00:00Z"), ZoneOffset.UTC);

    @Mock
    private TransactionRepository transactions;
    @Mock
    private AssetRepository assets;
    @Mock
    private CategoryRepository categories;

    private ReportService service() {
        return new ReportService(transactions, assets, categories, clock);
    }

    @Test
    void totalsAreGroupedPerCurrencyAndTransfersAreExcluded() {
        LocalDate from = LocalDate.of(2024, 5, 1);
        LocalDate to = LocalDate.of(2024, 5, 31);
        when(transactions.sumByCurrencyAndType(1L, from, to)).thenReturn(List.of(
                new Object[] {"MYR", "income", new BigDecimal("5000.0000"), 2L},
                new Object[] {"MYR", "expense", new BigDecimal("1000.0000"), 3L},
                new Object[] {"USD", "expense", new BigDecimal("2000.0000"), 1L},
                // A transfer only moves money between accounts: it must not inflate either side.
                new Object[] {"MYR", "transfer", new BigDecimal("9999.0000"), 1L}));
        when(categories.findByOwnerIdOrderBySortOrderAscIdAsc(1L)).thenReturn(List.of(category(7L, "cat-food", "餐饮")));
        when(transactions.sumExpenseByCategory(1L, from, to)).thenReturn(List.of(
                new Object[] {"MYR", 7L, new BigDecimal("400.0000"), 2L},
                new Object[] {"MYR", 9L, new BigDecimal("100.0000"), 1L}));

        ReportDtos.Summary summary = service().summary(1L, from, to, null);

        assertThat(summary.currencies()).hasSize(2);
        ReportDtos.CurrencySummary myr = summary.currencies().get(0);
        assertThat(myr.currency()).isEqualTo("MYR");
        assertThat(myr.income()).isEqualByComparingTo("5000.0000");
        assertThat(myr.expense()).isEqualByComparingTo("1000.0000");
        assertThat(myr.net()).isEqualByComparingTo("4000.0000");
        assertThat(myr.transactionCount()).isEqualTo(5L);
        assertThat(myr.categories()).extracting(ReportDtos.CategoryTotal::name)
                .containsExactly("餐饮", "(deleted category)");
        ReportDtos.CurrencySummary usd = summary.currencies().get(1);
        assertThat(usd.currency()).isEqualTo("USD");
        assertThat(usd.net()).isEqualByComparingTo("-2000.0000");
    }

    @Test
    void filteringByCurrencyStillAnswersWithAZeroBlockWhenThereIsNoData() {
        LocalDate from = LocalDate.of(2024, 5, 1);
        LocalDate to = LocalDate.of(2024, 5, 31);
        when(transactions.sumByCurrencyAndType(1L, from, to)).thenReturn(List.of());
        when(categories.findByOwnerIdOrderBySortOrderAscIdAsc(1L)).thenReturn(List.of());
        when(transactions.sumExpenseByCategory(1L, from, to)).thenReturn(List.of());

        ReportDtos.Summary summary = service().summary(1L, from, to, "eur");

        assertThat(summary.currencyFilter()).isEqualTo("EUR");
        assertThat(summary.currencies()).hasSize(1);
        assertThat(summary.currencies().get(0).net()).isEqualByComparingTo("0.0000");
    }

    @Test
    void assetBalancesFollowTheAppFormulaAndNeverBlendCurrencies() {
        when(transactions.sumSingleAssetByType(1L)).thenReturn(List.of(
                new Object[] {10L, "income", new BigDecimal("50.0000")},
                new Object[] {10L, "expense", new BigDecimal("20.0000")}));
        when(transactions.sumTransferIn(1L)).thenReturn(List.<Object[]>of(
                new Object[] {10L, new BigDecimal("10.0000")}));
        when(transactions.sumTransferOut(1L)).thenReturn(List.<Object[]>of(
                new Object[] {10L, new BigDecimal("5.0000")}));
        when(assets.findByOwnerIdOrderBySortOrderAscIdAsc(1L)).thenReturn(List.of(
                asset(10L, "acc-1", "Cash", "MYR", "100.0000"),
                asset(11L, "acc-2", "Travel", "USD", "10.0000")));

        ReportDtos.AssetBalances balances = service().assetBalances(1L);

        ReportDtos.AssetBalance cash = balances.assets().get(0);
        assertThat(cash.balance()).isEqualByComparingTo("135.0000");
        assertThat(balances.assets().get(1).balance()).isEqualByComparingTo("10.0000");
        assertThat(balances.totalsByCurrency()).hasSize(2);
        assertThat(balances.totalsByCurrency().get(0).currency()).isEqualTo("MYR");
        assertThat(balances.totalsByCurrency().get(0).balance()).isEqualByComparingTo("135.0000");
        assertThat(balances.totalsByCurrency().get(1).currency()).isEqualTo("USD");
    }

    private static Category category(long id, String clientUid, String name) {
        Category category = new Category();
        category.setId(id);
        category.setOwnerId(1L);
        category.setClientUid(clientUid);
        category.setName(name);
        category.setIcon("x");
        category.setType("expense");
        return category;
    }

    private static Asset asset(long id, String clientUid, String name, String currency, String initialBalance) {
        Asset asset = new Asset();
        asset.setId(id);
        asset.setOwnerId(1L);
        asset.setClientUid(clientUid);
        asset.setName(name);
        asset.setIcon("wallet");
        asset.setColor("#112233");
        asset.setType("cash");
        asset.setCurrency(currency);
        asset.setInitialBalance(new BigDecimal(initialBalance));
        return asset;
    }
}
