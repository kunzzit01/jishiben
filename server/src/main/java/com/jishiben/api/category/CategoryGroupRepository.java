package com.jishiben.api.category;

import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

public interface CategoryGroupRepository extends JpaRepository<CategoryGroup, Long> {

    List<CategoryGroup> findByOwnerIdOrderBySortOrderAscIdAsc(Long ownerId);

    Optional<CategoryGroup> findByOwnerIdAndClientUid(Long ownerId, String clientUid);

    Optional<CategoryGroup> findByOwnerIdAndName(Long ownerId, String name);
}
