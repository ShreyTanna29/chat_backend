# Space Members API Documentation

## Overview

The Space Members feature allows users to collaborate by sharing spaces with other users. Space owners can add members, assign roles, and manage access to their spaces. Members can view and participate in conversations within shared spaces based on their permissions.

**Base URL:** `https://eruditeaic.com/api/chat`

**Authentication:** All endpoints require Bearer token authentication.

---

## User Roles

| Role     | Description                                                                |
| -------- | -------------------------------------------------------------------------- |
| `owner`  | Creator of the space. Has full control including deleting the space.       |
| `admin`  | Can add/remove members and modify space settings. Cannot delete the space. |
| `member` | Can view and participate in space conversations. Cannot modify settings.   |

---

## Table of Contents

1. [Search Users](#1-search-users)
2. [Add Member to Space](#2-add-member-to-space)
3. [List Space Members](#3-list-space-members)
4. [Remove Member from Space](#4-remove-member-from-space)
5. [Update Member Role](#5-update-member-role)

---

## Database Migration Required

Before using these endpoints, you must run the Prisma migration to add the space members table:

```bash
npx prisma migrate dev --name add_space_members
```

This will create the `space_members` table and update the schema.

---

## 1. Search Users

Search for users by email or name to find users to add to your space.

### Endpoint

```
GET /api/auth/users/search
```

### Headers

```
Authorization: Bearer <jwt_token>
```

### Query Parameters

| Parameter | Type    | Required | Default | Description                     |
| --------- | ------- | -------- | ------- | ------------------------------- |
| `q`       | string  | Yes      | -       | Search query (min 2 characters) |
| `limit`   | integer | No       | 10      | Maximum number of results       |

### Success Response (200 OK)

```json
{
  "success": true,
  "data": [
    {
      "id": "clx9z8y7x6w5v4u3t2s1r0q9",
      "name": "John Doe",
      "email": "john@example.com",
      "avatar": "https://example.com/avatar.jpg"
    },
    {
      "id": "clx8y7x6w5v4u3t2s1r0q9p8",
      "name": "John Smith",
      "email": "jsmith@example.com",
      "avatar": null
    }
  ]
}
```

### Error Responses

**400 Bad Request** - Query too short

```json
{
  "success": false,
  "message": "Search query must be at least 2 characters"
}
```

### Example Request

```javascript
const response = await fetch(
  `https://eruditeaic.com/api/auth/users/search?q=john&limit=10`,
  {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  },
);
const data = await response.json();
```

### React/React Native Example

```javascript
const searchUsers = async (query, limit = 10) => {
  try {
    const token = await getAuthToken();

    if (query.trim().length < 2) {
      throw new Error("Search query must be at least 2 characters");
    }

    const response = await fetch(
      `https://eruditeaic.com/api/auth/users/search?q=${encodeURIComponent(query)}&limit=${limit}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    );

    const data = await response.json();

    if (!data.success) {
      throw new Error(data.message);
    }

    return data.data;
  } catch (error) {
    console.error("Error searching users:", error);
    throw error;
  }
};

// Usage
const users = await searchUsers("john");
console.log(`Found ${users.length} users`);
```

---

## 2. Add Member to Space

Add a user as a member to an existing space. Only space owners and admins can add members.

### Endpoint

```
POST /api/chat/spaces/:id/members
```

### Headers

```
Authorization: Bearer <jwt_token>
Content-Type: application/json
```

### URL Parameters

| Parameter | Type   | Description     |
| --------- | ------ | --------------- |
| `id`      | string | Space ID (cuid) |

### Request Body

```json
{
  "userId": "clx9z8y7x6w5v4u3t2s1r0q9",
  "role": "member"
}
```

| Field    | Type   | Required | Default  | Description                          |
| -------- | ------ | -------- | -------- | ------------------------------------ |
| `userId` | string | Yes      | -        | ID of the user to add as a member    |
| `role`   | string | No       | "member" | Role to assign ("member" or "admin") |

### Success Response (201 Created)

```json
{
  "success": true,
  "data": {
    "id": "clx3c4d5e6f7g8h9i0j1k2l3",
    "spaceId": "clx1a2b3c4d5e6f7g8h9i0j1",
    "userId": "clx9z8y7x6w5v4u3t2s1r0q9",
    "role": "member",
    "addedAt": "2025-01-20T10:30:00.000Z",
    "addedBy": "clx8y7z6a5b4c3d2e1f0g9h8",
    "user": {
      "id": "clx9z8y7x6w5v4u3t2s1r0q9",
      "name": "John Doe",
      "email": "john@example.com",
      "avatar": "https://example.com/avatar.jpg"
    }
  }
}
```

### Error Responses

**400 Bad Request** - Missing userId

```json
{
  "success": false,
  "message": "userId is required"
}
```

**403 Forbidden** - User doesn't have permission

```json
{
  "success": false,
  "message": "Only space owners and admins can add members"
}
```

**404 Not Found** - Space doesn't exist

```json
{
  "success": false,
  "message": "Space not found"
}
```

**409 Conflict** - User is already a member

```json
{
  "success": false,
  "message": "User is already a member of this space"
}
```

### Example Request

```javascript
const response = await fetch(
  `https://eruditeaic.com/api/chat/spaces/${spaceId}/members`,
  {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      userId: "clx9z8y7x6w5v4u3t2s1r0q9",
      role: "member",
    }),
  },
);
const data = await response.json();
```

### React/React Native Example

```javascript
const addMemberToSpace = async (spaceId, userId, role = "member") => {
  try {
    const token = await getAuthToken(); // Your auth token retrieval method

    const response = await fetch(
      `https://eruditeaic.com/api/chat/spaces/${spaceId}/members`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ userId, role }),
      },
    );

    const data = await response.json();

    if (!data.success) {
      throw new Error(data.message);
    }

    return data.data;
  } catch (error) {
    console.error("Error adding member:", error);
    throw error;
  }
};

// Usage
await addMemberToSpace(
  "clx1a2b3c4d5e6f7g8h9i0j1",
  "clx9z8y7x6w5v4u3t2s1r0q9",
  "admin",
);
```

---

## 2. List Space Members

Retrieve all members of a space, including the owner. Any member of the space can view the member list.

### Endpoint

```
GET /api/chat/spaces/:id/members
```

### Headers

```
Authorization: Bearer <jwt_token>
```

### URL Parameters

| Parameter | Type   | Description     |
| --------- | ------ | --------------- |
| `id`      | string | Space ID (cuid) |

### Success Response (200 OK)

```json
{
  "success": true,
  "data": {
    "owner": {
      "id": "clx8y7z6a5b4c3d2e1f0g9h8",
      "name": "Jane Smith",
      "email": "jane@example.com",
      "avatar": "https://example.com/jane-avatar.jpg",
      "role": "owner",
      "addedAt": "2025-01-10T10:30:00.000Z"
    },
    "members": [
      {
        "id": "clx3c4d5e6f7g8h9i0j1k2l3",
        "name": "John Doe",
        "email": "john@example.com",
        "avatar": "https://example.com/avatar.jpg",
        "role": "admin",
        "addedAt": "2025-01-15T14:20:00.000Z",
        "addedBy": "clx8y7z6a5b4c3d2e1f0g9h8"
      },
      {
        "id": "clx4d5e6f7g8h9i0j1k2l3m4",
        "name": "Alice Johnson",
        "email": "alice@example.com",
        "avatar": "https://example.com/alice-avatar.jpg",
        "role": "member",
        "addedAt": "2025-01-18T09:15:00.000Z",
        "addedBy": "clx8y7z6a5b4c3d2e1f0g9h8"
      }
    ]
  }
}
```

### Error Responses

**403 Forbidden** - User is not a member

```json
{
  "success": false,
  "message": "Access denied"
}
```

**404 Not Found** - Space doesn't exist

```json
{
  "success": false,
  "message": "Space not found"
}
```

### Example Request

```javascript
const response = await fetch(
  `https://eruditeaic.com/api/chat/spaces/${spaceId}/members`,
  {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  },
);
const data = await response.json();
```

### React/React Native Example

```javascript
const getSpaceMembers = async (spaceId) => {
  try {
    const token = await getAuthToken();

    const response = await fetch(
      `https://eruditeaic.com/api/chat/spaces/${spaceId}/members`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    );

    const data = await response.json();

    if (!data.success) {
      throw new Error(data.message);
    }

    return data.data;
  } catch (error) {
    console.error("Error fetching members:", error);
    throw error;
  }
};

// Usage
const { owner, members } = await getSpaceMembers("clx1a2b3c4d5e6f7g8h9i0j1");
console.log(`Owner: ${owner.name}`);
console.log(`Members: ${members.length}`);
```

---

## 3. Remove Member from Space

Remove a member from a space. Can be performed by:

- Space owner or admins (can remove any member except the owner)
- The member themselves (self-removal)

### Endpoint

```
DELETE /api/chat/spaces/:id/members/:userId
```

### Headers

```
Authorization: Bearer <jwt_token>
```

### URL Parameters

| Parameter | Type   | Description              |
| --------- | ------ | ------------------------ |
| `id`      | string | Space ID (cuid)          |
| `userId`  | string | User ID to remove (cuid) |

### Success Response (200 OK)

```json
{
  "success": true,
  "message": "Member removed successfully"
}
```

### Error Responses

**400 Bad Request** - Attempting to remove the owner

```json
{
  "success": false,
  "message": "Cannot remove the space owner"
}
```

**403 Forbidden** - User doesn't have permission

```json
{
  "success": false,
  "message": "You don't have permission to remove this member"
}
```

**404 Not Found** - Space doesn't exist

```json
{
  "success": false,
  "message": "Space not found"
}
```

### Example Request

```javascript
const response = await fetch(
  `https://eruditeaic.com/api/chat/spaces/${spaceId}/members/${userId}`,
  {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  },
);
const data = await response.json();
```

### React/React Native Example

```javascript
const removeMemberFromSpace = async (spaceId, userId) => {
  try {
    const token = await getAuthToken();

    const response = await fetch(
      `https://eruditeaic.com/api/chat/spaces/${spaceId}/members/${userId}`,
      {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    );

    const data = await response.json();

    if (!data.success) {
      throw new Error(data.message);
    }

    return data;
  } catch (error) {
    console.error("Error removing member:", error);
    throw error;
  }
};

// Usage - Remove another user (as owner/admin)
await removeMemberFromSpace(
  "clx1a2b3c4d5e6f7g8h9i0j1",
  "clx9z8y7x6w5v4u3t2s1r0q9",
);

// Usage - Leave space (self-removal)
await removeMemberFromSpace("clx1a2b3c4d5e6f7g8h9i0j1", currentUserId);
```

---

## 4. Update Member Role

Update a member's role in a space. Only the space owner can update member roles.

### Endpoint

```
PATCH /api/chat/spaces/:id/members/:userId
```

### Headers

```
Authorization: Bearer <jwt_token>
Content-Type: application/json
```

### URL Parameters

| Parameter | Type   | Description              |
| --------- | ------ | ------------------------ |
| `id`      | string | Space ID (cuid)          |
| `userId`  | string | User ID to update (cuid) |

### Request Body

```json
{
  "role": "admin"
}
```

| Field  | Type   | Required | Description                    |
| ------ | ------ | -------- | ------------------------------ |
| `role` | string | Yes      | New role ("member" or "admin") |

### Success Response (200 OK)

```json
{
  "success": true,
  "data": {
    "id": "clx3c4d5e6f7g8h9i0j1k2l3",
    "spaceId": "clx1a2b3c4d5e6f7g8h9i0j1",
    "userId": "clx9z8y7x6w5v4u3t2s1r0q9",
    "role": "admin",
    "addedAt": "2025-01-15T14:20:00.000Z",
    "addedBy": "clx8y7z6a5b4c3d2e1f0g9h8"
  }
}
```

### Error Responses

**400 Bad Request** - Invalid role or attempting to change owner's role

```json
{
  "success": false,
  "message": "role must be 'member' or 'admin'"
}
```

```json
{
  "success": false,
  "message": "Cannot change the role of the space owner"
}
```

**403 Forbidden** - User is not the owner

```json
{
  "success": false,
  "message": "Only the space owner can update member roles"
}
```

**404 Not Found** - Space doesn't exist

```json
{
  "success": false,
  "message": "Space not found"
}
```

### Example Request

```javascript
const response = await fetch(
  `https://eruditeaic.com/api/chat/spaces/${spaceId}/members/${userId}`,
  {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      role: "admin",
    }),
  },
);
const data = await response.json();
```

### React/React Native Example

```javascript
const updateMemberRole = async (spaceId, userId, role) => {
  try {
    const token = await getAuthToken();

    if (!["member", "admin"].includes(role)) {
      throw new Error("Role must be 'member' or 'admin'");
    }

    const response = await fetch(
      `https://eruditeaic.com/api/chat/spaces/${spaceId}/members/${userId}`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ role }),
      },
    );

    const data = await response.json();

    if (!data.success) {
      throw new Error(data.message);
    }

    return data.data;
  } catch (error) {
    console.error("Error updating member role:", error);
    throw error;
  }
};

// Usage - Promote member to admin
await updateMemberRole(
  "clx1a2b3c4d5e6f7g8h9i0j1",
  "clx9z8y7x6w5v4u3t2s1r0q9",
  "admin",
);

// Usage - Demote admin to member
await updateMemberRole(
  "clx1a2b3c4d5e6f7g8h9i0j1",
  "clx9z8y7x6w5v4u3t2s1r0q9",
  "member",
);
```

---

## Updated Space Endpoints

The following existing endpoints have been updated to support member access:

### GET /api/chat/spaces

Now returns both owned spaces and spaces where the user is a member.

**Response includes `userRole` field:**

```json
{
  "success": true,
  "data": {
    "spaces": [
      {
        "id": "clx1a2b3c4d5e6f7g8h9i0j1",
        "name": "Work Projects",
        "userRole": "owner",
        "_count": {
          "conversations": 5,
          "members": 3
        }
      },
      {
        "id": "clx2b3c4d5e6f7g8h9i0j1k2",
        "name": "Team Collaboration",
        "userRole": "admin",
        "_count": {
          "conversations": 8,
          "members": 7
        }
      },
      {
        "id": "clx3c4d5e6f7g8h9i0j1k2l3",
        "name": "Shared Resources",
        "userRole": "member",
        "_count": {
          "conversations": 12,
          "members": 15
        }
      }
    ]
  }
}
```

### GET /api/chat/spaces/:id

Now accessible by any member (not just the owner).

**Response includes `userRole` field:**

```json
{
  "success": true,
  "data": {
    "id": "clx1a2b3c4d5e6f7g8h9i0j1",
    "userId": "clx8y7z6a5b4c3d2e1f0g9h8",
    "name": "Work Projects",
    "defaultPrompt": "You are a professional software development assistant.",
    "userRole": "member",
    "createdAt": "2025-01-10T10:30:00.000Z",
    "updatedAt": "2025-01-15T14:20:00.000Z"
  }
}
```

### PUT /api/chat/spaces/:id

Now accessible by owner and admins (not just the owner).

### GET /api/chat/spaces/:id/conversations

Now accessible by any member (not just the owner).

---

## Complete React/React Native Hook Example

Here's a complete example of a custom hook to manage space members:

```javascript
import { useState, useCallback } from "react";

const useSpaceMembers = () => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const getAuthToken = async () => {
    // Implement your token retrieval logic
    // e.g., from AsyncStorage, SecureStore, or state management
    return "your_auth_token";
  };

  const fetchMembers = useCallback(async (spaceId) => {
    setLoading(true);
    setError(null);
    try {
      const token = await getAuthToken();
      const response = await fetch(
        `https://eruditeaic.com/api/chat/spaces/${spaceId}/members`,
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      );

      const data = await response.json();
      if (!data.success) throw new Error(data.message);

      return data.data;
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const addMember = useCallback(async (spaceId, userId, role = "member") => {
    setLoading(true);
    setError(null);
    try {
      const token = await getAuthToken();
      const response = await fetch(
        `https://eruditeaic.com/api/chat/spaces/${spaceId}/members`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ userId, role }),
        },
      );

      const data = await response.json();
      if (!data.success) throw new Error(data.message);

      return data.data;
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const removeMember = useCallback(async (spaceId, userId) => {
    setLoading(true);
    setError(null);
    try {
      const token = await getAuthToken();
      const response = await fetch(
        `https://eruditeaic.com/api/chat/spaces/${spaceId}/members/${userId}`,
        {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      );

      const data = await response.json();
      if (!data.success) throw new Error(data.message);

      return data;
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const updateRole = useCallback(async (spaceId, userId, role) => {
    setLoading(true);
    setError(null);
    try {
      const token = await getAuthToken();
      const response = await fetch(
        `https://eruditeaic.com/api/chat/spaces/${spaceId}/members/${userId}`,
        {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ role }),
        },
      );

      const data = await response.json();
      if (!data.success) throw new Error(data.message);

      return data.data;
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  return {
    fetchMembers,
    addMember,
    removeMember,
    updateRole,
    loading,
    error,
  };
};

export default useSpaceMembers;
```

### Usage in a Component

```javascript
import React, { useEffect, useState } from "react";
import { View, Text, Button, FlatList } from "react-native";
import useSpaceMembers from "./hooks/useSpaceMembers";

const SpaceMembersScreen = ({ spaceId }) => {
  const [members, setMembers] = useState({ owner: null, members: [] });
  const { fetchMembers, addMember, removeMember, updateRole, loading, error } =
    useSpaceMembers();

  useEffect(() => {
    loadMembers();
  }, [spaceId]);

  const loadMembers = async () => {
    try {
      const data = await fetchMembers(spaceId);
      setMembers(data);
    } catch (err) {
      console.error("Failed to load members:", err);
    }
  };

  const handleAddMember = async (userId) => {
    try {
      await addMember(spaceId, userId, "member");
      await loadMembers(); // Refresh the list
    } catch (err) {
      console.error("Failed to add member:", err);
    }
  };

  const handleRemoveMember = async (userId) => {
    try {
      await removeMember(spaceId, userId);
      await loadMembers(); // Refresh the list
    } catch (err) {
      console.error("Failed to remove member:", err);
    }
  };

  const handlePromoteToAdmin = async (userId) => {
    try {
      await updateRole(spaceId, userId, "admin");
      await loadMembers(); // Refresh the list
    } catch (err) {
      console.error("Failed to update role:", err);
    }
  };

  return (
    <View>
      <Text>Owner: {members.owner?.name}</Text>

      <FlatList
        data={members.members}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <View>
            <Text>
              {item.name} - {item.role}
            </Text>
            <Button
              title="Remove"
              onPress={() => handleRemoveMember(item.id)}
            />
            {item.role === "member" && (
              <Button
                title="Promote to Admin"
                onPress={() => handlePromoteToAdmin(item.id)}
              />
            )}
          </View>
        )}
      />

      {loading && <Text>Loading...</Text>}
      {error && <Text>Error: {error}</Text>}
    </View>
  );
};

export default SpaceMembersScreen;
```

---

## Permission Matrix

| Action                | Owner | Admin | Member |
| --------------------- | ----- | ----- | ------ |
| View space            | ✅    | ✅    | ✅     |
| View conversations    | ✅    | ✅    | ✅     |
| View members          | ✅    | ✅    | ✅     |
| Add members           | ✅    | ✅    | ❌     |
| Remove members        | ✅    | ✅    | ❌     |
| Remove self           | ❌    | ✅    | ✅     |
| Update space settings | ✅    | ✅    | ❌     |
| Update member roles   | ✅    | ❌    | ❌     |
| Delete space          | ✅    | ❌    | ❌     |

---

## Notes

1. **Member Visibility**: All space members can see who else is a member of the space.

2. **Self-Removal**: Members can remove themselves from a space at any time (except the owner).

3. **Owner Protection**: The space owner cannot be removed and cannot have their role changed.

4. **Cascading Deletes**: When a space is deleted, all member associations are automatically removed.

5. **Duplicate Prevention**: Users cannot be added to a space they're already a member of.

6. **Search for Users**: To add members, you'll need to implement a user search endpoint or maintain a list of available users. The member endpoints expect a valid user ID.

---

## Error Handling Best Practices

Always handle errors gracefully in your frontend:

```javascript
try {
  const member = await addMember(spaceId, userId);
  // Show success message
} catch (error) {
  if (error.message === "User is already a member of this space") {
    // Show specific message
  } else if (error.message === "Only space owners and admins can add members") {
    // Show permission error
  } else {
    // Show generic error
  }
}
```

---

## Testing the API

You can test the endpoints using curl:

```bash
# Add a member
curl -X POST https://eruditeaic.com/api/chat/spaces/SPACE_ID/members \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"userId": "USER_ID", "role": "member"}'

# List members
curl -X GET https://eruditeaic.com/api/chat/spaces/SPACE_ID/members \
  -H "Authorization: Bearer YOUR_TOKEN"

# Remove a member
curl -X DELETE https://eruditeaic.com/api/chat/spaces/SPACE_ID/members/USER_ID \
  -H "Authorization: Bearer YOUR_TOKEN"

# Update member role
curl -X PATCH https://eruditeaic.com/api/chat/spaces/SPACE_ID/members/USER_ID \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"role": "admin"}'
```

---

## Support

For questions or issues with the Space Members API, please contact the development team or refer to the main API documentation.
