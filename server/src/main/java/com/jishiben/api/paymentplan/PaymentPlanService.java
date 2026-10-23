package com.jishiben.api.paymentplan;

import com.jishiben.api.common.ApiException;
import com.jishiben.api.common.Checks;
import com.jishiben.api.common.Money;
import com.jishiben.api.common.Texts;
import com.jishiben.api.resolve.RefMaps;
import com.jishiben.api.resolve.ReferenceResolver;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Set;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class PaymentPlanService {

    static final Set<String> TYPES = Set.of("expense", "income");
    static final Set<String> CYCLES = Set.of("weekly", "monthly", "yearly");

    private final PaymentPlanRepository plans;
    private final ReferenceResolver references;

    public PaymentPlanService(PaymentPlanRepository plans, ReferenceResolver references) {
        this.plans = plans;
        this.references = references;
    }

    @Transactional(readOnly = true)
    public List<PaymentPlanDtos.Response> list(long ownerId, boolean includeArchived) {
        RefMaps maps = references.loadMaps(ownerId);
        return plans.findByOwnerIdOrderBySortOrderAscIdAsc(ownerId).stream()
                .filter(plan -> includeArchived || plan.getArchivedAt() == null)
                .map(plan -> toResponse(plan, maps))
                .toList();
    }

    @Transactional(readOnly = true)
    public PaymentPlanDtos.Response get(long ownerId, String clientUid) {
        return toResponse(require(ownerId, clientUid), references.loadMaps(ownerId));
    }

    @Transactional
    public PaymentPlanDtos.Response upsert(long ownerId, PaymentPlanDtos.UpsertRequest request) {
        String uid = Texts.requireNonBlank(request.clientUid(), "clientUid");
        Texts.limit(uid, 64, "clientUid");
        PaymentPlan plan = plans.findByOwnerIdAndClientUid(ownerId, uid).orElse(null);
        if (plan == null) {
            plan = new PaymentPlan();
            plan.setOwnerId(ownerId);
            plan.setClientUid(uid);
        }
        plan.setLedgerId(references.requiredLedger(ownerId, request.ledgerUid()));
        plan.setCategoryId(references.optionalCategory(ownerId, request.categoryUid()));
        plan.setAssetId(references.optionalAsset(ownerId, request.assetUid()));
        plan.setName(Texts.requireNonBlank(request.name(), "name"));
        plan.setAmount(Money.requireAmount(request.amount(), "amount"));
        plan.setType(Checks.oneOf(request.type(), TYPES, "type"));
        plan.setCycle(Checks.oneOf(request.cycle(), CYCLES, "cycle"));
        plan.setDayOfWeek(Checks.small(request.dayOfWeek(), 1, 7, "dayOfWeek"));
        plan.setDayOfMonth(Checks.small(request.dayOfMonth(), 1, 31, "dayOfMonth"));
        plan.setMonthOfYear(Checks.small(request.monthOfYear(), 1, 12, "monthOfYear"));
        plan.setDay(Checks.small(request.day(), 1, 31, "day"));
        plan.setStartDate(requireStart(request.startDate()));
        plan.setEndDate(request.endDate());
        plan.setAutoDeduct(request.autoDeduct() == null || request.autoDeduct());
        plan.setLastProcessedDate(request.lastProcessedDate());
        plan.setActive(request.active() == null || request.active());
        plan.setSortOrder(request.sortOrder() == null ? 0 : request.sortOrder());
        applyArchived(plan, request.archived());
        validateRange(plan);
        return toResponse(plans.save(plan), references.loadMaps(ownerId));
    }

    @Transactional
    public PaymentPlanDtos.Response patch(long ownerId, String clientUid, PaymentPlanDtos.PatchRequest request) {
        PaymentPlan plan = require(ownerId, clientUid);
        if (request.ledgerUid() != null) {
            plan.setLedgerId(references.requiredLedger(ownerId, request.ledgerUid()));
        }
        if (request.categoryUid() != null) {
            plan.setCategoryId(references.optionalCategory(ownerId, request.categoryUid()));
        }
        if (request.assetUid() != null) {
            plan.setAssetId(references.optionalAsset(ownerId, request.assetUid()));
        }
        if (request.name() != null) {
            plan.setName(Texts.requireNonBlank(request.name(), "name"));
        }
        if (request.amount() != null) {
            plan.setAmount(Money.requireAmount(request.amount(), "amount"));
        }
        if (request.type() != null) {
            plan.setType(Checks.oneOf(request.type(), TYPES, "type"));
        }
        if (request.cycle() != null) {
            plan.setCycle(Checks.oneOf(request.cycle(), CYCLES, "cycle"));
        }
        if (request.dayOfWeek() != null) {
            plan.setDayOfWeek(Checks.small(request.dayOfWeek(), 1, 7, "dayOfWeek"));
        }
        if (request.dayOfMonth() != null) {
            plan.setDayOfMonth(Checks.small(request.dayOfMonth(), 1, 31, "dayOfMonth"));
        }
        if (request.monthOfYear() != null) {
            plan.setMonthOfYear(Checks.small(request.monthOfYear(), 1, 12, "monthOfYear"));
        }
        if (request.day() != null) {
            plan.setDay(Checks.small(request.day(), 1, 31, "day"));
        }
        if (request.startDate() != null) {
            plan.setStartDate(request.startDate());
        }
        if (request.endDate() != null) {
            plan.setEndDate(request.endDate());
        }
        if (request.autoDeduct() != null) {
            plan.setAutoDeduct(request.autoDeduct());
        }
        if (request.lastProcessedDate() != null) {
            plan.setLastProcessedDate(request.lastProcessedDate());
        }
        if (request.active() != null) {
            plan.setActive(request.active());
        }
        if (request.sortOrder() != null) {
            plan.setSortOrder(request.sortOrder());
        }
        applyArchived(plan, request.archived());
        validateRange(plan);
        return toResponse(plans.save(plan), references.loadMaps(ownerId));
    }

    @Transactional
    public void delete(long ownerId, String clientUid) {
        plans.delete(require(ownerId, clientUid));
    }

    private static void validateRange(PaymentPlan plan) {
        if (plan.getEndDate() != null && plan.getStartDate() != null
                && plan.getEndDate().isBefore(plan.getStartDate())) {
            throw ApiException.validation("endDate must not be before startDate");
        }
    }

    private static LocalDate requireStart(LocalDate startDate) {
        if (startDate == null) {
            throw ApiException.validation("startDate is required");
        }
        return startDate;
    }

    private static void applyArchived(PaymentPlan plan, Boolean archived) {
        if (archived == null) {
            return;
        }
        plan.setArchivedAt(archived ? Instant.now() : null);
    }

    private PaymentPlan require(long ownerId, String clientUid) {
        String uid = Texts.requireNonBlank(clientUid, "clientUid");
        return plans.findByOwnerIdAndClientUid(ownerId, uid)
                .orElseThrow(() -> ApiException.notFound("Payment plan not found: " + uid));
    }

    static PaymentPlanDtos.Response toResponse(PaymentPlan plan, RefMaps maps) {
        return new PaymentPlanDtos.Response(
                plan.getClientUid(),
                maps.ledger(plan.getLedgerId()),
                maps.category(plan.getCategoryId()),
                maps.asset(plan.getAssetId()),
                plan.getName(),
                plan.getAmount(),
                plan.getType(),
                plan.getCycle(),
                Checks.unbox(plan.getDayOfWeek()),
                Checks.unbox(plan.getDayOfMonth()),
                Checks.unbox(plan.getMonthOfYear()),
                Checks.unbox(plan.getDay()),
                plan.getStartDate(),
                plan.getEndDate(),
                plan.isAutoDeduct(),
                plan.getLastProcessedDate(),
                plan.isActive(),
                plan.getSortOrder(),
                plan.getArchivedAt() != null,
                plan.getCreatedAt(),
                plan.getUpdatedAt());
    }
}
