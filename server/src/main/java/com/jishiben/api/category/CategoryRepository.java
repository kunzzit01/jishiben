package com.jishiben.api.category;

import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

public interface CategoryRepository extends JpaRepository<Category, Long> {

    List<Category> findByOwnerIdOrderBySortOrderAscIdAsc(Long ownerId);

    List<Category> findByOwnerIdAndTypeOrderBySortOrderAscIdAsc(Long ownerId, String type);

    List<Category> findByOwnerIdAndGroupIdOrderBySortOrderAscIdAsc(Long ownerId, Long groupId);

    Optional<Category> findByOwnerIdAndClientUid(Long ownerId, String clientUid);

    Optional<Category> findByIdAndOwnerId(Long id, Long ownerId);
}
