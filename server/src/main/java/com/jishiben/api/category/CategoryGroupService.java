package com.jishiben.api.category;

import com.jishiben.api.common.ApiException;
import com.jishiben.api.common.Checks;
import com.jishiben.api.common.Texts;
import java.time.Instant;
import java.util.List;
import java.util.Set;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class CategoryGroupService {

    static final Set<String> TYPES = Set.of("expense", "income");

    private final CategoryGroupRepository groups;

    public CategoryGroupService(CategoryGroupRepository groups) {
        this.groups = groups;
    }

    @Transactional(readOnly = true)
    public List<CategoryDtos.GroupResponse> list(long ownerId, boolean includeArchived) {
        return groups.findByOwnerIdOrderBySortOrderAscIdAsc(ownerId).stream()
                .filter(group -> includeArchived || group.getArchivedAt() == null)
                .map(CategoryGroupService::toResponse)
                .toList();
    }

    @Transactional(readOnly = true)
    public CategoryDtos.GroupResponse get(long ownerId, String clientUid) {
        return toResponse(require(ownerId, clientUid));
    }

    @Transactional
    public CategoryDtos.GroupResponse upsert(long ownerId, CategoryDtos.GroupUpsertRequest request) {
        String uid = Texts.requireNonBlank(request.clientUid(), "clientUid");
        Texts.limit(uid, 64, "clientUid");
        CategoryGroup group = groups.findByOwnerIdAndClientUid(ownerId, uid).orElse(null);
        if (group == null) {
            group = new CategoryGroup();
            group.setOwnerId(ownerId);
            group.setClientUid(uid);
        }
        group.setName(uniqueName(ownerId, Texts.requireNonBlank(request.name(), "name"), uid));
        group.setColor(Checks.color(request.color()));
        group.setIcon(Texts.trimToNull(request.icon()));
        group.setType(Checks.oneOf(request.type(), TYPES, "type"));
        group.setSortOrder(request.sortOrder() == null ? 0 : request.sortOrder());
        applyArchived(group, request.archived());
        return toResponse(groups.save(group));
    }

    @Transactional
    public CategoryDtos.GroupResponse patch(long ownerId, String clientUid, CategoryDtos.GroupPatchRequest request) {
        CategoryGroup group = require(ownerId, clientUid);
        if (request.name() != null) {
            group.setName(uniqueName(ownerId, Texts.requireNonBlank(request.name(), "name"),
                    group.getClientUid()));
        }
        if (request.color() != null) {
            group.setColor(Checks.color(request.color()));
        }
        if (request.icon() != null) {
            group.setIcon(Texts.trimToNull(request.icon()));
        }
        if (request.type() != null) {
            group.setType(Checks.oneOf(request.type(), TYPES, "type"));
        }
        if (request.sortOrder() != null) {
            group.setSortOrder(request.sortOrder());
        }
        applyArchived(group, request.archived());
        return toResponse(groups.save(group));
    }

    /** Deleting a group does not delete its categories: they become ungrouped (FK SET NULL). */
    @Transactional
    public void delete(long ownerId, String clientUid) {
        groups.delete(require(ownerId, clientUid));
    }

    private String uniqueName(long ownerId, String name, String clientUid) {
        CategoryGroup existing = groups.findByOwnerIdAndName(ownerId, name).orElse(null);
        if (existing != null && !existing.getClientUid().equals(clientUid)) {
            throw ApiException.conflict("A category group named '" + name + "' already exists");
        }
        return name;
    }

    private static void applyArchived(CategoryGroup group, Boolean archived) {
        if (archived == null) {
            return;
        }
        group.setArchivedAt(archived ? Instant.now() : null);
    }

    private CategoryGroup require(long ownerId, String clientUid) {
        String uid = Texts.requireNonBlank(clientUid, "clientUid");
        return groups.findByOwnerIdAndClientUid(ownerId, uid)
                .orElseThrow(() -> ApiException.notFound("Category group not found: " + uid));
    }

    static CategoryDtos.GroupResponse toResponse(CategoryGroup group) {
        return new CategoryDtos.GroupResponse(group.getClientUid(), group.getName(), group.getColor(),
                group.getIcon(), group.getType(), group.getSortOrder(), group.getArchivedAt() != null,
                group.getCreatedAt(), group.getUpdatedAt());
    }
}
