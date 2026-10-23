package com.jishiben.api.push;

import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

public interface PushTokenRepository extends JpaRepository<PushToken, Long> {

    Optional<PushToken> findByToken(String token);

    Optional<PushToken> findByOwnerIdAndToken(Long ownerId, String token);

    List<PushToken> findByOwnerIdOrderByLastSeenAtDescIdDesc(Long ownerId);

    long deleteByOwnerIdAndToken(Long ownerId, String token);
}
