package com.jishiben.api.report;

import com.jishiben.api.asset.Asset;
import com.jishiben.api.asset.AssetRepository;
import com.jishiben.api.category.Category;
import com.jishiben.api.category.CategoryRepository;
import com.jishiben.api.common.ApiException;
import com.jishiben.api.common.Money;
import com.jishiben.api.common.Texts;
import com.jishiben.api.transaction.TransactionRepository;
import java.math.BigDecimal;
import java.time.Clock;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Aggregations over the caller's own rows. Every figure stays inside one currency; the response is a
 * list of per-currency blocks precisely so no caller can accidentally add mixed currencies together.
 */
@Service
public class ReportService {

    private final TransactionRepository transactions;
    private final AssetRepository assets;
    private final CategoryRepository categories;
    private final Clock clock;

    public ReportService(TransactionRepository transactions, AssetRepository assets,
                         CategoryRepository categories, Clock clock) {
        this.transactions = transactions;
        this.assets = assets;
        this.categories = categories;
        this.clock = clock;
    }

    @Transactional(readOnly = true)
    public ReportDtos.Summary summary(long ownerId, LocalDate from, LocalDate to, String currency) {
        LocalDate end = to != null ? to : LocalDate.now(clock);
        LocalDate start = from != null ? from : end.withDayOfMonth(1);
        if (start.isAfter(end)) {
            throw ApiException.validation("from must not be after to");
        }
        String filter = Texts.trimToNull(currency);
        if (filter != null) {
            filter = Texts.upperCurrency(filter, "currency");
        }

        Map<String, Totals> blocks = new TreeMap<>();
        for (Object[] row : transactions.sumByCurrencyAndType(ownerId, start, end)) {
            String rowCurrency = String.valueOf(row[0]);
            String type = String.valueOf(row[1]);
            BigDecimal amount = amount(row[2]);
            long count = count(row[3]);
            Totals totals = blocks.computeIfAbsent(rowCurrency, key -> new Totals());
            if ("income".equals(type)) {
                totals.income = Money.plus(totals.income, amount);
                totals.count += count;
            } else if ("expense".equals(type)) {
                totals.expense = Money.plus(totals.expense, amount);
                totals.count += count;
            }
        }

        Map<Long, Category> categoryById = new HashMap<>();
        categories.findByOwnerIdOrderBySortOrderAscIdAsc(ownerId)
                .forEach(category -> categoryById.put(category.getId(), category));

        for (Object[] row : transactions.sumExpenseByCategory(ownerId, start, end)) {
            String rowCurrency = String.valueOf(row[0]);
            long categoryId = ((Number) row[1]).longValue();
            Category category = categoryById.get(categoryId);
            blocks.computeIfAbsent(rowCurrency, key -> new Totals()).categories.add(new ReportDtos.CategoryTotal(
                    category == null ? null : category.getClientUid(),
                    category == null ? "(deleted category)" : category.getName(),
                    amount(row[2]),
                    count(row[3])));
        }

        if (filter != null) {
            // Filtering must still answer, even when the range holds no rows in that currency.
            blocks.computeIfAbsent(filter, key -> new Totals());
        }

        List<ReportDtos.CurrencySummary> result = new ArrayList<>();
        for (Map.Entry<String, Totals> entry : blocks.entrySet()) {
            if (filter != null && !filter.equals(entry.getKey())) {
                continue;
            }
            Totals totals = entry.getValue();
            totals.categories.sort(Comparator.comparing(ReportDtos.CategoryTotal::amount).reversed());
            result.add(new ReportDtos.CurrencySummary(entry.getKey(), totals.income, totals.expense,
                    Money.plus(totals.income, totals.expense.negate()), totals.count,
                    List.copyOf(totals.categories)));
        }
        return new ReportDtos.Summary(start, end, filter, result);
    }

    @Transactional(readOnly = true)
    public ReportDtos.AssetBalances assetBalances(long ownerId) {
        Map<Long, BigDecimal> income = new HashMap<>();
        Map<Long, BigDecimal> expense = new HashMap<>();
        for (Object[] row : transactions.sumSingleAssetByType(ownerId)) {
            long assetId = ((Number) row[0]).longValue();
            String type = String.valueOf(row[1]);
            BigDecimal total = amount(row[2]);
            if ("income".equals(type)) {
                income.put(assetId, total);
            } else if ("expense".equals(type)) {
                expense.put(assetId, total);
            }
        }
        Map<Long, BigDecimal> transferIn = new HashMap<>();
        for (Object[] row : transactions.sumTransferIn(ownerId)) {
            transferIn.put(((Number) row[0]).longValue(), amount(row[1]));
        }
        Map<Long, BigDecimal> transferOut = new HashMap<>();
        for (Object[] row : transactions.sumTransferOut(ownerId)) {
            transferOut.put(((Number) row[0]).longValue(), amount(row[1]));
        }

        List<ReportDtos.AssetBalance> rows = new ArrayList<>();
        Map<String, BigDecimal> totalsByCurrency = new TreeMap<>();
        for (Asset asset : assets.findByOwnerIdOrderBySortOrderAscIdAsc(ownerId)) {
            BigDecimal in = money(income.get(asset.getId()));
            BigDecimal out = money(expense.get(asset.getId()));
            BigDecimal moveIn = money(transferIn.get(asset.getId()));
            BigDecimal moveOut = money(transferOut.get(asset.getId()));
            BigDecimal balance = Money.plus(Money.plus(asset.getInitialBalance(), in),
                    Money.plus(out.negate(), Money.plus(moveIn, moveOut.negate())));
            rows.add(new ReportDtos.AssetBalance(asset.getClientUid(), asset.getName(), asset.getType(),
                    asset.getCurrency(), asset.getArchivedAt() != null, asset.getInitialBalance(), in, out,
                    moveIn, moveOut, balance));
            totalsByCurrency.merge(asset.getCurrency(), balance, Money::plus);
        }
        List<ReportDtos.CurrencyTotal> totals = totalsByCurrency.entrySet().stream()
                .map(entry -> new ReportDtos.CurrencyTotal(entry.getKey(), entry.getValue()))
                .toList();
        return new ReportDtos.AssetBalances(rows, totals);
    }

    private static BigDecimal amount(Object value) {
        if (value == null) {
            return BigDecimal.ZERO.setScale(Money.SCALE);
        }
        if (value instanceof BigDecimal decimal) {
            return decimal.setScale(Money.SCALE, java.math.RoundingMode.HALF_UP);
        }
        return new BigDecimal(value.toString()).setScale(Money.SCALE, java.math.RoundingMode.HALF_UP);
    }

    private static BigDecimal money(BigDecimal value) {
        return value == null ? BigDecimal.ZERO.setScale(Money.SCALE) : value.setScale(Money.SCALE,
                java.math.RoundingMode.HALF_UP);
    }

    private static long count(Object value) {
        return value instanceof Number number ? number.longValue() : 0L;
    }

    private static final class Totals {
        private BigDecimal income = BigDecimal.ZERO.setScale(Money.SCALE);
        private BigDecimal expense = BigDecimal.ZERO.setScale(Money.SCALE);
        private long count;
        private final List<ReportDtos.CategoryTotal> categories = new ArrayList<>();
    }
}
