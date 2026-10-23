package com.jishiben.api.category;

import com.jishiben.api.common.ApiException;
import com.jishiben.api.common.Checks;
import com.jishiben.api.common.Texts;
import java.time.Instant;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class CategoryService {

    private final CategoryRepository categories;
    private final CategoryGroupRepository groups;

    public CategoryService(CategoryRepository categories, CategoryGroupRepository groups) {
        this.categories = categories;
        this.groups = groups;
    }

    @Transactional(readOnly = true)
    public List<CategoryDtos.Response> list(long ownerId, String type, String groupUid, boolean includeArchived) {
        String cleanType = Checks.optionalOneOf(type, CategoryGroupService.TYPES, "type");
        String cleanGroup = Texts.trimToNull(groupUid);
        List<Category> rows;
        if (cleanType != null) {
            rows = categories.findByOwnerIdAndTypeOrderBySortOrderAscIdAsc(ownerId, cleanType);
        } else {
            rows = categories.findByOwnerIdOrderBySortOrderAscIdAsc(ownerId);
        }
        if (cleanGroup != null) {
            Long groupId = groupIdOf(ownerId, cleanGroup);
            rows = rows.stream().filter(category -> groupId.equals(category.getGroupId())).toList();
        }
        if (!includeArchived) {
            rows = rows.stream().filter(category -> category.getArchivedAt() == null).toList();
        }
        Map<Long, String> groupUids = groupUids(ownerId);
        return rows.stream().map(category -> toResponse(category, groupUids)).toList();
    }

    @Transactional(readOnly = true)
    public CategoryDtos.Response get(long ownerId, String clientUid) {
        return toResponse(require(ownerId, clientUid), groupUids(ownerId));
    }

    @Transactional
    public CategoryDtos.Response upsert(long ownerId, CategoryDtos.UpsertRequest request) {
        String uid = Texts.requireNonBlank(request.clientUid(), "clientUid");
        Texts.limit(uid, 64, "clientUid");
        Category category = categories.findByOwnerIdAndClientUid(ownerId, uid).orElse(null);
        if (category == null) {
            category = new Category();
            category.setOwnerId(ownerId);
            category.setClientUid(uid);
        }
        category.setName(Texts.requireNonBlank(request.name(), "name"));
        category.setIcon(Texts.requireNonBlank(request.icon(), "icon"));
        category.setColor(Checks.color(request.color()));
        category.setType(Checks.oneOf(request.type(), CategoryGroupService.TYPES, "type"));
        category.setGroupId(resolveGroup(ownerId, request.groupUid(), category.getType()));
        category.setSortOrder(request.sortOrder() == null ? 0 : request.sortOrder());
        applyArchived(category, request.archived());
        return toResponse(categories.save(category), groupUids(ownerId));
    }

    @Transactional
    public CategoryDtos.Response patch(long ownerId, String clientUid, CategoryDtos.PatchRequest request) {
        Category category = require(ownerId, clientUid);
        if (request.name() != null) {
            category.setName(Texts.requireNonBlank(request.name(), "name"));
        }
        if (request.icon() != null) {
            category.setIcon(Texts.requireNonBlank(request.icon(), "icon"));
        }
        if (request.color() != null) {
            category.setColor(Checks.color(request.color()));
        }
        if (request.type() != null) {
            category.setType(Checks.oneOf(request.type(), CategoryGroupService.TYPES, "type"));
        }
        if (request.groupUid() != null) {
            category.setGroupId(resolveGroup(ownerId, request.groupUid(), category.getType()));
        }
        if (request.sortOrder() != null) {
            category.setSortOrder(request.sortOrder());
        }
        applyArchived(category, request.archived());
        return toResponse(categories.save(category), groupUids(ownerId));
    }

    /** History survives: transactions.category_id and payment_plans.category_id go NULL, budgets cascade. */
    @Transactional
    public void delete(long ownerId, String clientUid) {
        categories.delete(require(ownerId, clientUid));
    }

    /**
     * '' means "ungrouped" and must become NULL. A group of the other type is rejected: the app's
     * grouping is typed, so a category cannot sit under a group of the opposite direction.
     */
    private Long resolveGroup(long ownerId, String groupUid, String categoryType) {
        String uid = Texts.trimToNull(groupUid);
        if (uid == null) {
            return null;
        }
        CategoryGroup group = groups.findByOwnerIdAndClientUid(ownerId, uid)
                .orElseThrow(() -> ApiException.validation(
                        "groupUid does not reference one of your category groups: " + uid));
        if (!group.getType().equals(categoryType)) {
            throw ApiException.validation("Category type '" + categoryType
                    + "' does not match its group type '" + group.getType() + "'");
        }
        return group.getId();
    }

    private Long groupIdOf(long ownerId, String groupUid) {
        return groups.findByOwnerIdAndClientUid(ownerId, groupUid)
                .orElseThrow(() -> ApiException.validation(
                        "groupUid does not reference one of your category groups: " + groupUid))
                .getId();
    }

    private Map<Long, String> groupUids(long ownerId) {
        Map<Long, String> map = new HashMap<>();
        groups.findByOwnerIdOrderBySortOrderAscIdAsc(ownerId)
                .forEach(group -> map.put(group.getId(), group.getClientUid()));
        return map;
    }

    private static void applyArchived(Category category, Boolean archived) {
        if (archived == null) {
            return;
        }
        category.setArchivedAt(archived ? Instant.now() : null);
    }

    private Category require(long ownerId, String clientUid) {
        String uid = Texts.requireNonBlank(clientUid, "clientUid");
        return categories.findByOwnerIdAndClientUid(ownerId, uid)
                .orElseThrow(() -> ApiException.notFound("Category not found: " + uid));
    }

    private static CategoryDtos.Response toResponse(Category category, Map<Long, String> groupUids) {
        return new CategoryDtos.Response(
                category.getClientUid(),
                category.getGroupId() == null ? null : groupUids.get(category.getGroupId()),
                category.getName(),
                category.getIcon(),
                category.getColor(),
                category.getType(),
                category.getSortOrder(),
                category.getArchivedAt() != null,
                category.getCreatedAt(),
                category.getUpdatedAt());
    }
}
